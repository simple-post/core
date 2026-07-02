import { getPostingSummary, type PostingResult } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { sanitizeForJson } from "@/lib/utils/errors";
import type { AccountResultsMap } from "@/types";

export interface RepostOutcome {
  summary: ReturnType<typeof getPostingSummary>;
  /** Per-account results, sanitized for JSON persistence. */
  repostResults: AccountResultsMap;
  /** Non-null only when the repost failed. */
  errorMessage: string | null;
  /** Sanitized `{ failedPlatforms }` payload, non-null only on failure. */
  errorDetails: Record<string, unknown> | null;
}

/**
 * Distills raw repost results into the shape both the auto-repost dispatcher
 * and the manual repost endpoint persist, so the "did it succeed / what to
 * store" logic lives in exactly one place.
 */
export function summarizeRepostOutcome(results: PostingResult[]): RepostOutcome {
  const summary = getPostingSummary(results);
  const repostResults = sanitizeForJson(toAccountResultsMap(results)) as AccountResultsMap;

  if (summary.overallSuccess) {
    return { summary, repostResults, errorMessage: null, errorDetails: null };
  }

  const failedResults = results.filter((result) => !result.success);
  const errorMessage =
    failedResults.length === 1
      ? failedResults[0].message || failedResults[0].error || "Unknown repost error"
      : `Failed to repost on ${failedResults.length} platform(s)`;

  const errorDetails = sanitizeForJson({
    failedPlatforms: failedResults.map((result) => ({
      accountId: result.accountId,
      platform: result.platform,
      error: result.error,
      message: result.message,
      details: result.details,
    })),
  }) as Record<string, unknown>;

  return { summary, repostResults, errorMessage, errorDetails };
}
