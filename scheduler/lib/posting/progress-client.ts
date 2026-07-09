export interface PostingProgressResult {
  accountId: string;
  platform: string;
  accountName?: string;
  success?: boolean;
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

export function failPendingPostingResults(current: PostingProgressResult[], message: string): PostingProgressResult[] {
  return current.map((result) =>
    result.success === undefined ? { ...result, success: false, error: message } : result,
  );
}
