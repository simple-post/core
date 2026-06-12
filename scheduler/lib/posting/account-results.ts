import type { AccountPublishResult, AccountResultsMap } from "@/types";

import type { PostingResult } from "./index";

/**
 * Per-account publish outcome bookkeeping. Stored on Post.accountResults so
 * that retrying a partially failed post only publishes to the accounts that
 * have not succeeded yet, instead of double-posting to the ones that did.
 */

export function toAccountResultsMap(results: PostingResult[]): AccountResultsMap {
  const completedAt = new Date().toISOString();
  const map: AccountResultsMap = {};

  for (const result of results) {
    map[result.accountId] = {
      accountId: result.accountId,
      platform: result.platform,
      success: result.success,
      postId: result.postId,
      postUrl: result.postUrl,
      error: result.error,
      message: result.message,
      completedAt,
    } satisfies AccountPublishResult;
  }

  return map;
}

/**
 * Merges fresh posting results over previously persisted ones. A recorded
 * success is never downgraded; failed entries are replaced by the latest
 * attempt.
 */
export function mergeAccountResults(
  previous: AccountResultsMap | null | undefined,
  results: PostingResult[],
): AccountResultsMap {
  const merged: AccountResultsMap = { ...previous };

  for (const [accountId, result] of Object.entries(toAccountResultsMap(results))) {
    if (merged[accountId]?.success) continue;
    merged[accountId] = result;
  }

  return merged;
}

/** Account ids that already have a recorded successful publish. */
export function getSucceededAccountIds(accountResults: AccountResultsMap | null | undefined): Set<string> {
  const succeeded = new Set<string>();
  for (const result of Object.values(accountResults ?? {})) {
    if (result.success) succeeded.add(result.accountId);
  }
  return succeeded;
}
