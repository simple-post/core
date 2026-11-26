import { generateFileKey, uploadFromBuffer } from "@simple-post/sdk";

import { assertCanCreatePost, lockUserForQuota } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { joinedValidationMessages } from "@/lib/i18n/validation-display";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/utils/errors";
import { queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import type { MediaFile } from "@/types";

import { authorize, lockWorkspace, membership, type Tx } from "./access";
import { snapshotSchema, type Actor, type Variant } from "./contracts";
import { recordEvent } from "./posts";

async function approved(tx: Tx, actor: Actor, workspaceId: string, postId: string, reviewId: string) {
  authorize(await membership(tx, workspaceId, actor.id), "edit");
  const post = await tx.teamPost.findFirst({
    where: { id: postId, workspaceId },
    include: { state: true, workspace: { select: { creatorId: true } } },
  });
  if (!post) throw new NotFoundError("Post not found");
  const review = await tx.teamReview.findFirst({ where: { id: reviewId, postId, outcome: "approved" } });
  if (!review || post.currentReviewId !== review.id || post.state.kind !== "approved")
    throw new ConflictError("Approve the current version before releasing it");
  const content = snapshotSchema.parse(review.snapshot);
  if (content.variants.some((v) => v.accountId) && post.workspace.creatorId !== actor.id)
    throw new ForbiddenError("Only the account owner can schedule connected destinations");
  return { post, content };
}

async function verifyDestination(tx: Tx, userId: string, workspaceId: string, v: Variant) {
  const account = await tx.connectedAccount.findFirst({
    where: {
      userId,
      workspaceId,
      id: v.accountId!,
      platform: v.platform,
      platformAccountId: v.destination!.platformAccountId,
    },
  });
  if (!account)
    throw new ConflictError(
      "The reviewed destination is unavailable in this workspace. Edit the post, select a workspace account, and submit it again.",
    );
}

export async function release(actor: Actor, workspaceId: string, postId: string, reviewId: string) {
  const { post, content } = await prisma.$transaction((tx) => approved(tx, actor, workspaceId, postId, reviewId));
  if (post.deliveredAt) return;
  const connected = content.variants.filter((v) => v.accountId);
  const prepared: { params: Parameters<typeof validatePostForAccounts>[0]; variant: Variant }[] = [];
  const uploaded = new Map<string, MediaFile>();
  for (const variant of connected) {
    if (new Date(content.plannedAt) <= new Date())
      throw new BadRequestError("Choose a future time and resubmit for approval");
    await verifyDestination(prisma, actor.id, workspaceId, variant);
    const accountId = variant.accountId!;
    const media: MediaFile[] = [];
    for (const fileId of variant.fileIds) {
      let copy = uploaded.get(fileId);
      if (!copy) {
        const file = await prisma.teamFile.findFirstOrThrow({ where: { id: fileId, workspaceId } });
        const key = generateFileKey(actor.id, "approved." + file.mime.split("/")[1]);
        const url = await uploadFromBuffer(Buffer.from(file.bytes), key, file.mime);
        await prisma.$transaction((tx) => queueStorageDeletion(tx, actor.id, url));
        copy = {
          id: file.id,
          url,
          type: file.mime.startsWith("video/") ? "video" : "image",
          filename: file.filename,
          size: file.bytes.length,
          contentType: file.mime,
        };
        uploaded.set(fileId, copy);
      }
      media.push(copy);
    }
    const params = {
      userId: actor.id,
      workspaceId,
      message: variant.caption,
      accountIds: [accountId],
      media,
      accountOptions: { [accountId]: variant.options },
      accountOverrides: { [accountId]: { media } },
    };
    const validation = await validatePostForAccounts(params);
    if (!validation.summary.isValid)
      throw new BadRequestError(validation.summary.errors.map((e) => e.message).join(" "));
    const issues = await getCredentialIssuesForPublishTime({
      userId: actor.id,
      accountIds: [accountId],
      publishAt: new Date(content.plannedAt),
    });
    if (issues.length > 0) throw new BadRequestError(joinedValidationMessages(issues, " "));
    prepared.push({ params, variant });
  }
  return prisma.$transaction(async (tx) => {
    // Billing always locks the creator first. Uploads and platform checks run outside both locks.
    if (connected.length > 0) await lockUserForQuota(tx, actor.id);
    await lockWorkspace(tx, workspaceId);
    const current = await approved(tx, actor, workspaceId, postId, reviewId);
    if (current.post.deliveredAt) return;
    if (prepared.length > 0 && new Date(content.plannedAt) <= new Date())
      throw new ConflictError("The approved publication time has passed");
    for (const { params, variant } of prepared) {
      await verifyDestination(tx, actor.id, workspaceId, variant);
      await assertCanCreatePost(actor.id, tx);
      await new PostsModel(actor.id).createPost(
        { ...params, workspaceReviewId: reviewId, scheduledFor: new Date(content.plannedAt), status: "scheduled" },
        actor.id,
        tx,
      );
    }
    await tx.teamPost.update({ where: { id: postId }, data: { deliveredAt: new Date(), revision: { increment: 1 } } });
    await recordEvent(tx, postId, actor, prepared.length > 0 ? "scheduled" : "published natively", "", reviewId);
  });
}

export async function cancelDelivery(actor: Actor, workspaceId: string, postId: string, deliveryId: string) {
  await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, actor.id);
    await lockWorkspace(tx, workspaceId);
    authorize(await membership(tx, workspaceId, actor.id), "edit");
    const delivery = await tx.post.findFirst({
      where: { id: deliveryId, userId: actor.id, workspaceReview: { post: { id: postId, workspaceId } } },
      select: { updatedAt: true, status: true },
    });
    if (!delivery) throw new NotFoundError("Delivery unavailable");
    if (delivery.status !== "scheduled") throw new ConflictError("This delivery is no longer scheduled.");
    await new PostsModel(actor.id).deletePost(deliveryId, delivery.updatedAt, tx);
  });
}
