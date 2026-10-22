import type { PostingResult } from "@/lib/posting";

import type { PublishRecovery, TikTokVideoJob } from "@simple-post/sdk";

export const MAX_PUBLISH_ATTEMPTS = 3;
export const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STATUS_CHECK_INTERVAL_MS = 60_000;

export interface DurablePublishContext {
  job?: TikTokVideoJob;
  saveProgress: (job: TikTokVideoJob) => Promise<void>;
}

export function retryDelay(attempt: number, evidence?: PublishRecovery): number {
  const backoff = attempt <= 1 ? 60_000 : 300_000;
  return Math.max(backoff + Math.floor(Math.random() * 10_000), evidence?.retryAfterMs ?? 0);
}

export function isDeferredResult(result: { error?: string }): boolean {
  return result.error === "PUBLISH_RETRY_SCHEDULED" || result.error === "PUBLISH_PROCESSING";
}

/** Deferrals may coexist with terminal failures on other accounts. Finish those targets first. */
export function getPostDeferral(results: PostingResult[]): { nextAttemptAt: Date; errorMessage: string } | undefined {
  const waiting = results.filter((result) => isDeferredResult(result));
  if (waiting.length === 0) return;
  const times = waiting.map((r) => r.nextAttemptAt?.getTime()).filter((time): time is number => Number.isFinite(time));
  return {
    nextAttemptAt: new Date(times.length > 0 ? Math.min(...times) : Date.now() + STATUS_CHECK_INTERVAL_MS),
    errorMessage: waiting
      .map((r) => r.message)
      .filter(Boolean)
      .join(" "),
  };
}
