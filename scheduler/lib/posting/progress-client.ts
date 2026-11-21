import { ApiResponseError } from "@/lib/utils/api-response-error";

export interface PostingProgressResult {
  accountId: string;
  platform: string;
  accountName?: string;
  success?: boolean;
  uncertain?: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
  threadResults?: Array<{
    index: number;
    success: boolean;
    postId?: string;
    postUrl?: string;
    error?: string;
    message?: string;
    details?: unknown;
  }>;
}

export function mergePostingProgressResult(
  current: PostingProgressResult[],
  result: PostingProgressResult,
): PostingProgressResult[] {
  const existing = current.find((entry) => entry.accountId === result.accountId);
  if (!existing) return [...current, result];

  return current.map((entry) =>
    entry.accountId === result.accountId
      ? {
          ...entry,
          ...result,
          accountName: result.accountName ?? entry.accountName,
        }
      : entry,
  );
}

export function mergePostingProgressResults(
  current: PostingProgressResult[],
  results: PostingProgressResult[],
): PostingProgressResult[] {
  return results.reduce((merged, result) => mergePostingProgressResult(merged, result), current);
}

export function postingOutcomeUncertain(error: unknown): boolean {
  return !(error instanceof ApiResponseError && error.status >= 400 && error.status < 500);
}

export function failPendingPostingResults(
  current: PostingProgressResult[],
  message: string,
  uncertain = false,
): PostingProgressResult[] {
  return current.map((result) =>
    result.success === undefined
      ? { ...result, success: false, error: message, ...(uncertain ? { uncertain: true } : {}) }
      : result,
  );
}
