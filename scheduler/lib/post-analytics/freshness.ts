import type { AnalyticsStatus } from "@simple-post/sdk/analytics";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long cached analytics stay fresh. Young posts change quickly, so they
 * are refreshed often; old posts barely move and are refreshed rarely. This
 * keeps provider requests (and X read costs) proportional to usefulness.
 */
export function freshnessWindowMs(publishedAt: Date, now: Date = new Date()): number {
  const age = Math.max(0, now.getTime() - publishedAt.getTime());
  if (age < DAY) return 15 * MINUTE;
  if (age < 7 * DAY) return HOUR;
  if (age < 30 * DAY) return 6 * HOUR;
  if (age < 90 * DAY) return DAY;
  return 7 * DAY;
}

/** Retry delay after a failed read, growing with consecutive failures. */
function failureBackoffMs(status: AnalyticsStatus | "pending", failureCount: number): number {
  switch (status) {
    case "rate_limited": {
      return Math.min(6 * HOUR, 15 * MINUTE * 2 ** Math.min(failureCount, 5));
    }
    case "credentials_error": {
      return 6 * HOUR;
    }
    case "missing_permission":
    case "unsupported": {
      // Reconnecting the account resets the schedule (see isStale), so a long
      // wait here never hides newly granted permissions.
      return DAY;
    }
    case "not_found": {
      return 7 * DAY;
    }
    default: {
      return Math.min(DAY, 30 * MINUTE * 2 ** Math.min(failureCount, 5));
    }
  }
}

export function nextRefreshAt(params: {
  publishedAt: Date;
  status: AnalyticsStatus | "pending";
  failureCount: number;
  now?: Date;
}): Date {
  const now = params.now ?? new Date();
  const delay =
    params.status === "ok"
      ? freshnessWindowMs(params.publishedAt, now)
      : failureBackoffMs(params.status, params.failureCount);
  return new Date(now.getTime() + delay);
}

/**
 * Minimum time between two reads of the same post, even when a user forces a
 * refresh. Protects provider quotas from repeated clicks.
 */
export const FORCED_REFRESH_MIN_INTERVAL_MS = 2 * MINUTE;

export function isStale(
  row: { nextRefreshAt: Date; fetchedAt: Date | null; status: string },
  account: { updatedAt: Date } | undefined,
  now: Date = new Date(),
): boolean {
  if (row.nextRefreshAt.getTime() <= now.getTime()) return true;
  // A reconnect (new scopes/tokens) makes permission errors worth retrying immediately.
  if (
    account &&
    row.fetchedAt &&
    ["missing_permission", "credentials_error", "unsupported"].includes(row.status) &&
    account.updatedAt.getTime() > row.fetchedAt.getTime()
  ) {
    return true;
  }
  return false;
}

export function canForceRefresh(row: { fetchedAt: Date | null }, now: Date = new Date()): boolean {
  return !row.fetchedAt || now.getTime() - row.fetchedAt.getTime() >= FORCED_REFRESH_MIN_INTERVAL_MS;
}

/** Snapshots are kept hourly while a post is young and daily afterwards. */
export function snapshotIntervalMs(publishedAt: Date, now: Date = new Date()): number {
  return now.getTime() - publishedAt.getTime() < 7 * DAY ? HOUR : DAY;
}

/** Account-level analytics (followers, …) are refreshed at most this often. */
export const ACCOUNT_ANALYTICS_TTL_MS = 6 * HOUR;
