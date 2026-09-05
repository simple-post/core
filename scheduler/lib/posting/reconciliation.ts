import { Prisma } from "@prisma/client";
import { mapPlatformName } from "@simple-post/sdk/platform-names";
import { z } from "zod";

import { lockUserForQuota } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError, NotFoundError, sanitizeForJson } from "@/lib/utils/errors";

export const reconciliationSchema = z.object({
  accountId: z.string().min(1),
  operation: z.enum(["post", "repost"]),
  segment: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  confirmed: z.literal(true),
  outcome: z.enum(["published", "not_published"]),
  platformPostId: z.string().min(1).max(2048).optional(),
  postUrl: z.url().max(4096).optional(),
  bluesky: z.object({ uri: z.string().startsWith("at://").max(2048), cid: z.string().min(1).max(512) }).optional(),
});

/** Explicit user confirmation after checking the provider; never an automatic retry. */
export async function reconcilePublish(
  userId: string,
  postId: string,
  input: z.infer<typeof reconciliationSchema>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, userId);
    const post = await tx.post.findFirst({
      where: { id: postId, userId },
      select: { status: true, repostStatus: true },
    });
    if (!post) throw new NotFoundError("Post not found");
    if (post.status === "pending" || post.repostStatus === "pending")
      throw new ConflictError("Wait for publishing or stale-worker recovery to finish before reconciling.");
    const account = await tx.connectedAccount.findFirst({ where: { id: input.accountId, userId } });
    if (!account) throw new NotFoundError("Account not found");
    const where = {
      postId_accountId_operation_segment: {
        postId,
        accountId: input.accountId,
        operation: input.operation,
        segment: input.segment,
      },
    };
    const checkpoint = await tx.publishCheckpoint.findUnique({ where });
    if (!checkpoint) throw new NotFoundError("Publishing record not found");
    if (!["started", "unknown"].includes(checkpoint.state) || checkpoint.updatedAt.toISOString() !== input.updatedAt)
      throw new ConflictError("The publishing record changed. Reload it before reconciling.");
    if (input.outcome === "published" && !input.platformPostId)
      throw new BadRequestError("The published platform post ID is required.");
    if (input.outcome === "published" && mapPlatformName(account.platform) === "bluesky" && !input.bluesky)
      throw new BadRequestError("Bluesky reconciliation requires the post URI and CID to resume its reply chain.");
    const result =
      input.outcome === "published"
        ? {
            accountId: account.id,
            platform: account.platform,
            success: true,
            postId: input.platformPostId,
            postUrl: input.postUrl,
            ...(input.bluesky ? { platformData: input.bluesky, extraData: { platformData: input.bluesky } } : {}),
          }
        : undefined;
    const changed = await tx.publishCheckpoint.updateMany({
      where: { ...where.postId_accountId_operation_segment, state: checkpoint.state, updatedAt: checkpoint.updatedAt },
      data: {
        state: input.outcome === "published" ? "succeeded" : "failed",
        result: result ? (sanitizeForJson(result) as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    if (!changed.count) throw new ConflictError("Publishing completed while reconciling. Reload its result.");
  });
}
