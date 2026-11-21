/**
 * Runtime configuration for post analytics. See
 * docs/post-analytics/platform-permissions.md for the meaning of each
 * environment variable.
 */

const DEFAULT_X_DAILY_POST_READS = 300;

/**
 * Distinct X posts read per user per UTC day. X bills each post read (a post
 * read again the same UTC day is free), and the balance is shared with
 * publishing, so analytics must never drain it.
 */
export function xDailyPostReadLimit(): number {
  const raw = process.env.X_ANALYTICS_DAILY_POST_READS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_X_DAILY_POST_READS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_X_DAILY_POST_READS;
}

export function backgroundRefreshEnabled(): boolean {
  return (process.env.POST_ANALYTICS_BACKGROUND_REFRESH ?? "true").toLowerCase() !== "false";
}

/**
 * Platforms refreshed by the background sweep. X is excluded by default
 * because its reads are billed; it is still refreshed on demand.
 */
export function backgroundRefreshPlatforms(): { include?: string[]; exclude?: string[] } {
  const raw = process.env.POST_ANALYTICS_BACKGROUND_PLATFORMS?.trim().toLowerCase();
  if (!raw) return { exclude: ["x"] };
  if (raw === "all") return {};
  return { include: raw.split(/[\s,]+/).filter(Boolean) };
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
