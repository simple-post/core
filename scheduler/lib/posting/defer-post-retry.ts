import { type Prisma } from "@prisma/client";

import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

import { tikTokMediaPreparationFailureCode, tikTokProcessingFailureCode } from "./tiktok-recovery";

const RETRY_DELAY_MS = 60_000;
const MAX_MEDIA_RETRIES = 3;

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
          (result.error === "LOCAL_RATE_LIMIT" ||
            tikTokProcessingFailureCode(result) ||
            tikTokMediaPreparationFailureCode(result))) ||
        instagramProcessingFailure(result),
    )
  )
    return false;
  const previous =
    previousErrorDetails && typeof previousErrorDetails === "object" && !Array.isArray(previousErrorDetails)
      ? (previousErrorDetails as Record<string, unknown>)
      : {};
  const tikTokPreparationFailed = failures.some((result) => tikTokMediaPreparationFailureCode(result));
  const mediaRetries = [
    {
      message: tikTokPreparationFailed
        ? "SimplePost could not load the media for TikTok."
        : "TikTok could not process the media.",
      key: "tiktokProcessingRetryCount",
      applies: tikTokPreparationFailed || failures.some((result) => tikTokProcessingFailureCode(result)),
    },
    {
      message: "Instagram could not process the media.",
      key: "instagramProcessingRetryCount",
      applies: failures.some((result) => instagramProcessingFailure(result)),
    },
  ]
    .filter(({ applies }) => applies)
    .map(({ message, key }) => {
      const storedCount = previous[key];
      const count =
        typeof storedCount === "number" && Number.isSafeInteger(storedCount) && storedCount > 0 ? storedCount : 0;
      return { message, key, count: count + 1 };
    });
  if (mediaRetries.some(({ count }) => count > MAX_MEDIA_RETRIES)) return false;
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "scheduled",
      tiktokRetryApproved,
      scheduledFor: new Date(Date.now() + RETRY_DELAY_MS),
      errorMessage:
        mediaRetries.length > 0
          ? mediaRetries
              .map(
                ({ message, count }) => `${message} Retry ${count} of ${MAX_MEDIA_RETRIES} is scheduled in one minute.`,
              )
              .join(" ")
          : "Queued — waiting for TikTok's request limit. Another attempt is scheduled in one minute.",
      errorDetails: sanitizeForJson({
        ...previous,
        failedPlatforms: failures,
        ...Object.fromEntries(mediaRetries.map(({ key, count }) => [key, count])),
      }) as Prisma.InputJsonValue,
      accountResults: sanitizeForJson(accountResults) as Prisma.InputJsonValue,
      threadResults: sanitizeForJson(threadResults) as Prisma.InputJsonValue,
      repostStatus: "not_applicable",
      repostDueAt: null,
    },
  });
  return true;
}
