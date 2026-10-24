import { PostsModel } from "@/lib/db";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { validateQuoteSource } from "@/lib/quote/source";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/utils/errors";
import { getScheduledForValueError } from "@/lib/validations/scheduled-time";

import { getTikTokPostRecovery } from "./tiktok-recovery";

/** A timing-only recovery. Content, media, checkpoints, quotas and successful destinations stay intact. */
export async function scheduleTikTokRetry(
  userId: string,
  postId: string,
  scheduledForValue: string,
  expectedUpdatedAt?: string,
) {
  const error = getScheduledForValueError(scheduledForValue);
  if (error) throw new BadRequestError(error);
  const scheduledFor = new Date(scheduledForValue);
  const repository = new PostsModel(userId);
  const post = await repository.getPostById(postId);
  if (!post) throw new NotFoundError("Post not found");
  if (expectedUpdatedAt && post.updatedAt.toISOString() !== expectedUpdatedAt)
    throw new ConflictError("This post changed. Reload it before scheduling a retry.");
  const recovery = getTikTokPostRecovery(post);
  if (!recovery)
    throw new BadRequestError(
      "This post does not have a recoverable TikTok limit. Inspect its results before retrying.",
    );
  const failedIds = post.accountIds.filter((id) => !post.accountResults?.[id]?.success);
  const issues = await getCredentialIssuesForPublishTime({ userId, accountIds: failedIds, publishAt: scheduledFor });
  if (issues.length > 0) throw new BadRequestError(issues.map((issue) => issue.message).join(" "));
  await validateQuoteSource({
    userId,
    quotePostId: post.quotePostId ?? undefined,
    currentPostId: post.id,
    postingMode: "schedule",
    scheduledFor,
  });
  return prisma.$transaction(async (tx) => {
    const checkpoints = await tx.publishCheckpoint.findMany({ where: { postId } });
    for (const id of failedIds) {
      const pending = checkpoints.filter((checkpoint) => checkpoint.accountId === id);
      // A paused, never-attempted target has no checkpoint. An uncertain or
      // started operation must still be reconciled before any resubmission.
      if (
        pending.some((checkpoint) => !["failed", "succeeded"].includes(checkpoint.state)) ||
        (post.status === "failed" && pending.length === 0)
      )
        throw new BadRequestError("The previous upload outcome is uncertain. Reconcile it before retrying.");
    }
    const updated = await repository.updatePost(
      postId,
      {
        status: "scheduled",
        tiktokRetryApproved: true,
        scheduledFor,
        errorMessage: "Another TikTok attempt is scheduled. Acceptance is not guaranteed.",
      },
      { status: post.status, updatedAt: post.updatedAt },
      tx,
    );
    return updated;
  });
}
