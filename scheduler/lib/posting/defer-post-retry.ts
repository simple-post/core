import { type Prisma } from "@prisma/client";

import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

import { tikTokProcessingFailureCode } from "./tiktok-recovery";

const RETRY_DELAY_MS = 60_000;
const MAX_PROCESSING_RETRIES = 3;

function instagramProcessingFailure(result: PostingResult): boolean {
  if (result.platform !== "instagram" || result.error !== "PREPARATION_ERROR") return false;
  const details = result.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  const { phase, statusCode, containerId } = details as Record<string, unknown>;
  // Only terminal container failures before media_publish may start a fresh upload.
  // Generic API errors, timeouts and uncertain publishing outcomes are excluded.
  return (
    phase === "processing" &&
    (statusCode === "ERROR" || statusCode === "EXPIRED") &&
    typeof containerId === "string" &&
    containerId.length > 0
  );
}

/** Shared by immediate and scheduled publishing; never replay an uncertain result. */
export async function deferPostRetry(
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
        (result.platform === "tiktok" &&
          (result.error === "LOCAL_RATE_LIMIT" || tikTokProcessingFailureCode(result))) ||
        instagramProcessingFailure(result),
    )
  )
    return false;
  const previous =
    previousErrorDetails && typeof previousErrorDetails === "object" && !Array.isArray(previousErrorDetails)
      ? (previousErrorDetails as Record<string, unknown>)
      : {};
  const processingRetries = [
    {
      name: "TikTok",
      key: "tiktokProcessingRetryCount",
      applies: failures.some((result) => tikTokProcessingFailureCode(result)),
    },
    {
      name: "Instagram",
      key: "instagramProcessingRetryCount",
      applies: failures.some((result) => instagramProcessingFailure(result)),
    },
  ]
    .filter(({ applies }) => applies)
    .map(({ name, key }) => {
      const storedCount = previous[key];
      const count =
        typeof storedCount === "number" && Number.isSafeInteger(storedCount) && storedCount > 0 ? storedCount : 0;
      return { name, key, count: count + 1 };
    });
  if (processingRetries.some(({ count }) => count > MAX_PROCESSING_RETRIES)) return false;
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "scheduled",
      tiktokRetryApproved,
      scheduledFor: new Date(Date.now() + RETRY_DELAY_MS),
      errorMessage:
        processingRetries.length > 0
          ? processingRetries
              .map(
                ({ name, count }) =>
                  `${name} could not process the media. Retry ${count} of ${MAX_PROCESSING_RETRIES} is scheduled in one minute.`,
              )
              .join(" ")
          : "Queued — waiting for TikTok's request limit. Another attempt is scheduled in one minute.",
      errorDetails: sanitizeForJson({
        ...previous,
        failedPlatforms: failures,
        ...Object.fromEntries(processingRetries.map(({ key, count }) => [key, count])),
      }) as Prisma.InputJsonValue,
      accountResults: sanitizeForJson(accountResults) as Prisma.InputJsonValue,
      threadResults: sanitizeForJson(threadResults) as Prisma.InputJsonValue,
      repostStatus: "not_applicable",
      repostDueAt: null,
    },
  });
  return true;
}
