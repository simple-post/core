import { Flags } from "@oclif/core";

export const ANALYTICS_PERIODS = [
  "last_24h",
  "last_7d",
  "last_30d",
  "last_90d",
  "last_365d",
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "all_time",
] as const;

/** Friendly aliases accepted for --period. */
const PERIOD_ALIASES: Record<string, string> = {
  "24h": "last_24h",
  day: "last_24h",
  "7d": "last_7d",
  week: "last_7d",
  "30d": "last_30d",
  month: "last_30d",
  "90d": "last_90d",
  quarter: "last_90d",
  "12m": "last_365d",
  "365d": "last_365d",
  year: "last_365d",
  ytd: "this_year",
  all: "all_time",
};

export const SORT_METRICS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "quotes",
  "saves",
  "clicks",
  "profileVisits",
  "follows",
  "watchTimeSeconds",
  "averageWatchTimeSeconds",
  "engagements",
  "engagementRate",
  "publishedAt",
] as const;

export function normalizePeriod(value: string): string {
  const normalized = PERIOD_ALIASES[value.toLowerCase()] ?? value.toLowerCase().replaceAll("-", "_");
  if (!(ANALYTICS_PERIODS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unknown period "${value}". Use one of: ${[...Object.keys(PERIOD_ALIASES), ...ANALYTICS_PERIODS].join(", ")}.`,
    );
  }
  return normalized;
}

export const periodFlags = {
  period: Flags.string({
    char: "p",
    description: "Period: 24h, 7d, 30d, 90d, 12m, ytd, all, or this_week, last_month, last_year, … (default 30d).",
    helpGroup: "Period",
  }),
  from: Flags.string({ description: "Custom start date (YYYY-MM-DD).", helpGroup: "Period" }),
  to: Flags.string({ description: "Custom end date, inclusive (YYYY-MM-DD).", helpGroup: "Period" }),
  timezone: Flags.string({
    description: "IANA timezone for calendar periods and best times (defaults to this machine's timezone).",
    helpGroup: "Period",
  }),
  mode: Flags.string({
    options: ["published", "activity"],
    description:
      "published: lifetime metrics of posts published in the period. activity: what all posts gained during it.",
    helpGroup: "Period",
  }),
  platform: Flags.string({ multiple: true, description: "Only this platform (repeatable).", helpGroup: "Filters" }),
  "app-account-id": Flags.string({
    multiple: true,
    description: "Only this SimplePost account ID (repeatable).",
    helpGroup: "Filters",
  }),
};

export const refreshFlag = Flags.string({
  options: ["auto", "none", "force"],
  default: "auto",
  description: "auto: refresh stale numbers first; none: cached only; force: re-read everything.",
});

export const jsonFlag = Flags.boolean({ description: "Print the raw JSON response." });

export function periodQuery(flags: {
  period?: string;
  from?: string;
  to?: string;
  timezone?: string;
  mode?: string;
  platform?: string[];
  "app-account-id"?: string[];
}): URLSearchParams {
  const params = new URLSearchParams();
  if (flags.from || flags.to) {
    if (flags.from) params.set("from", flags.from);
    if (flags.to) params.set("to", flags.to);
  } else {
    params.set("period", normalizePeriod(flags.period ?? "30d"));
  }
  params.set("timeZone", flags.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  if (flags.mode) params.set("mode", flags.mode);
  for (const platform of flags.platform ?? [])
    params.append("platform", platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase());
  for (const accountId of flags["app-account-id"] ?? []) params.append("accountId", accountId);
  return params;
}
