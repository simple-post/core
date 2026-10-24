import { type Prisma } from "@prisma/client";

import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

/** Post Now also queues short, conclusive TikTok request limits instead of requiring a manual retry. */
export async function deferTikTokMinuteLimit(
  postId: string,
  results: PostingResult[],
  accountResults: unknown,
  threadResults: unknown,
) {
  const failures = results.filter((result) => !result.success);
  if (
    failures.length === 0 ||
    !failures.every((result) => result.platform === "tiktok" && result.error === "LOCAL_RATE_LIMIT")
  )
    return false;
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 60_000),
      errorMessage: "Queued — waiting for TikTok's request limit. Another attempt is scheduled in one minute.",
      errorDetails: sanitizeForJson({ failedPlatforms: failures }) as Prisma.InputJsonValue,
      accountResults: sanitizeForJson(accountResults) as Prisma.InputJsonValue,
      threadResults: sanitizeForJson(threadResults) as Prisma.InputJsonValue,
      repostStatus: "not_applicable",
      repostDueAt: null,
    },
  });
  return true;
}
