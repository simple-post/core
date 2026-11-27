import { isDeepStrictEqual } from "node:util";

import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/utils/errors";

import { authorize, lockWorkspace, membership, type Tx } from "./access";
import { snapshotSchema, type Actor, type Snapshot, type WorkspaceCommand } from "./contracts";
import { prepareOwnerRemoval } from "./ownership";
import { changeSettings } from "./settings";

export async function recordEvent(tx: Tx, postId: string, actor: Actor, kind: string, body: string, reviewId?: string) {
  await tx.teamEvent.create({ data: { postId, actorId: actor.id, actorName: actor.name, kind, body, reviewId } });
}
export function stale(): never {
  throw new ConflictError("This post changed. Reload it before continuing.");
}
export async function runCommand(
  actor: Actor,
  workspaceId: string,
  cmd: Exclude<WorkspaceCommand, { action: "release" | "cancelDelivery" }>,
) {
  return prisma.$transaction(async (tx) => {
    const successor =
      cmd.action === "remove" ? await prepareOwnerRemoval(tx, workspaceId, actor.id, cmd.userId) : undefined;
    await lockWorkspace(tx, workspaceId);
    const member = await membership(tx, workspaceId, actor.id);
    if (!("postId" in cmd) && cmd.action !== "createPost") {
      authorize(member, "admin");
      return changeSettings(tx, workspaceId, cmd, successor);
    }
    const post =
      "postId" in cmd
        ? await tx.teamPost.findFirst({ where: { id: cmd.postId, workspaceId }, include: { state: true } })
        : null;
    if (cmd.action !== "createPost" && !post) throw new NotFoundError("Post not found");
    const states = await tx.teamState.findMany({ where: { workspaceId } });
    const state = (kind: string) => states.find((s) => s.kind === kind)!.id;
    if (cmd.action === "comment") {
      if (!member.approver) authorize(member, "edit");
      await recordEvent(tx, cmd.postId, actor, "comment", cmd.body, post?.currentReviewId ?? undefined);
      return;
    }
    if (cmd.action === "decide") {
      authorize(member, "approve");
      if (post?.currentReviewId !== cmd.reviewId) stale();
      const review = await tx.teamReview.findFirstOrThrow({ where: { id: cmd.reviewId, postId: cmd.postId } });
      if (review.outcome === cmd.outcome && review.decidedBy === actor.id) return;
      if (review.outcome || post.state.kind !== "review") stale();
      await tx.teamReview.update({
        where: { id: review.id },
        data: { outcome: cmd.outcome, decidedBy: actor.id, decidedAt: new Date() },
      });
      await recordEvent(tx, post.id, actor, cmd.outcome, cmd.body, review.id);
      return tx.teamPost.update({
        where: { id: post.id },
        data: { revision: { increment: 1 }, stateId: state(cmd.outcome === "approved" ? "approved" : "progress") },
      });
    }
    authorize(member, "edit");
    if (cmd.action === "submit" && post?.state.kind === "review" && post.revision === cmd.revision + 1)
      return { id: post.currentReviewId };
    if (post && "revision" in cmd && cmd.revision !== post.revision) stale();
    const current = post ? snapshotSchema.parse({ ...post, plannedAt: post.plannedAt.toISOString() }) : null;
    async function invalidate() {
      if (!post?.currentReviewId) return;
      const pending = await tx.teamReview.updateMany({
        where: { id: post.currentReviewId, outcome: null },
        data: { outcome: "superseded" },
      });
      if (pending.count) await recordEvent(tx, post.id, actor, "superseded", "", post.currentReviewId);
      else if (post.state.kind === "approved")
        await recordEvent(tx, post.id, actor, "approval invalidated", "", post.currentReviewId);
    }
    if (cmd.action === "submit" && post && current) {
      if (post.deliveredAt || post.state.kind === "approved")
        throw new ConflictError("This version is already approved");
      if (post.state.kind === "review") return { id: post.currentReviewId };
      if (current.variants.some((v) => !v.caption.trim() && v.fileIds.length === 0))
        throw new BadRequestError("Add a caption or media to each platform");
      const review = await tx.teamReview.create({
        data: { postId: post.id, snapshot: current, requestedBy: actor.id },
      });
      await tx.teamPost.update({
        where: { id: post.id },
        data: { stateId: state("review"), currentReviewId: review.id, revision: { increment: 1 } },
      });
      await recordEvent(tx, post.id, actor, "submitted", "", review.id);
      return review;
    }
    if (cmd.action === "move" && post) {
      const next = states.find((s) => s.id === cmd.stateId);
      if (post.deliveredAt || !next || ["approved", "review"].includes(next.kind))
        throw new BadRequestError("Use a review decision to enter this state");
      if (post.stateId === next.id) return;
      await invalidate();
      await recordEvent(tx, post.id, actor, "moved", next.name);
      return tx.teamPost.update({
        where: { id: post.id },
        data: { stateId: next.id, currentReviewId: null, revision: { increment: 1 } },
      });
    }
    if (cmd.action !== "edit" && cmd.action !== "createPost") throw new BadRequestError("Unknown post action");
    if (cmd.ownerId) await membership(tx, workspaceId, cmd.ownerId);
    const snapshot: Snapshot = snapshotSchema.parse(cmd);
    const fileIds = [...new Set(snapshot.variants.flatMap((v) => v.fileIds))];
    if (fileIds.length !== (await tx.teamFile.count({ where: { workspaceId, id: { in: fileIds } } })))
      throw new BadRequestError("File unavailable");
    const workspace = await tx.teamWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    for (const v of snapshot.variants) {
      if (!v.accountId) {
        v.destination = null;
        continue;
      }
      const prior = current?.variants.find((old) => old.platform === v.platform && old.accountId === v.accountId);
      if (!prior && actor.id !== workspace.creatorId)
        throw new ForbiddenError("Only the creator can select a connected destination");
      const account = await tx.connectedAccount.findFirst({
        where: { id: v.accountId, workspaceId, userId: workspace.creatorId, platform: v.platform },
      });
      if (prior && (!account || prior.destination?.platformAccountId === account.platformAccountId)) {
        v.destination = prior.destination;
        continue;
      }
      if (!account)
        throw new BadRequestError("Connected destination unavailable. Choose an account connected to this workspace.");
      v.destination = {
        label: account.displayName || account.username || account.platformAccountId,
        platformAccountId: account.platformAccountId,
      };
    }
    if (snapshot.variants.some((v) => v.accountId) && snapshot.variants.some((v) => !v.accountId))
      throw new BadRequestError("Use separate posts for native and SimplePost publishing");
    const data = {
      ...snapshot,
      plannedAt: new Date(snapshot.plannedAt),
      ownerId: cmd.ownerId,
      dueAt: cmd.dueAt ? new Date(cmd.dueAt) : null,
    };
    if (!post) {
      const item = await tx.teamPost.create({ data: { ...data, workspaceId, stateId: state("draft") } });
      await recordEvent(tx, item.id, actor, "created", "");
      return item;
    }
    const changed = !isDeepStrictEqual(snapshot, current);
    if (changed && post.deliveredAt) throw new ConflictError("Released content is locked");
    if (changed) await invalidate();
    await recordEvent(tx, post.id, actor, "edited", "");
    return tx.teamPost.update({
      where: { id: post.id },
      data: {
        ...data,
        revision: { increment: 1 },
        ...(changed && post.currentReviewId ? { currentReviewId: null, stateId: state("progress") } : {}),
      },
    });
  });
}
