import { type Prisma } from "@prisma/client";

import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

import { tikTokProcessingFailureCode } from "./tiktok-recovery";

const RETRY_DELAY_MS = 60_000;
const MAX_PROCESSING_RETRIES = 3;

/** Shared by immediate and scheduled publishing; never replay an uncertain result. */
export async function deferTikTokRetry(
  postId: string,
  results: PostingResult[],
  accountResults: unknown,
  threadResults: unknown,
  tiktokRetryApproved = false,
  previousErrorDetails?: unknown,
) {
  const failures = results.filter((result) => !result.success);
  if (
    failures.length === 0 ||
    !failures.every(
      (result) =>
        result.platform === "tiktok" && (result.error === "LOCAL_RATE_LIMIT" || tikTokProcessingFailureCode(result)),
    )
  )
    return false;
  const previous =
    previousErrorDetails && typeof previousErrorDetails === "object" && !Array.isArray(previousErrorDetails)
      ? (previousErrorDetails as Record<string, unknown>)
      : {};
  const storedCount = previous.tiktokProcessingRetryCount;
  const retryCount =
    typeof storedCount === "number" && Number.isSafeInteger(storedCount) && storedCount > 0 ? storedCount : 0;
  const processingFailure = failures.some((result) => tikTokProcessingFailureCode(result));
  if (processingFailure && retryCount >= MAX_PROCESSING_RETRIES) return false;
  const nextCount = retryCount + (processingFailure ? 1 : 0);
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "scheduled",
      tiktokRetryApproved,
      scheduledFor: new Date(Date.now() + RETRY_DELAY_MS),
      errorMessage: processingFailure
        ? `TikTok could not process the media. Retry ${nextCount} of ${MAX_PROCESSING_RETRIES} is scheduled in one minute.`
        : "Queued — waiting for TikTok's request limit. Another attempt is scheduled in one minute.",
      errorDetails: sanitizeForJson({
        ...previous,
        failedPlatforms: failures,
        tiktokProcessingRetryCount: nextCount,
      }) as Prisma.InputJsonValue,
      accountResults: sanitizeForJson(accountResults) as Prisma.InputJsonValue,
      threadResults: sanitizeForJson(threadResults) as Prisma.InputJsonValue,
      repostStatus: "not_applicable",
      repostDueAt: null,
    },
  });
  return true;
}
