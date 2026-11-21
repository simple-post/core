import { PlatformSchema } from "@simple-post/sdk";
import { POST_METRIC_DEFINITIONS, type PostMetric, type PostMetrics } from "@simple-post/sdk/analytics";
import * as z from "zod";

import { canRefreshAnalytics } from "@/lib/post-analytics/access";
import { ANALYTICS_GRANULARITIES, resolvePeriod } from "@/lib/post-analytics/periods";
import {
  getAccountsAnalytics,
  getAnalyticsSummary,
  getPostAnalyticsView,
  listPostAnalytics,
  SORTABLE_METRICS,
  type AccountAnalyticsOverview,
  type AnalyticsSummary,
  type MetricTotals,
  type PostAnalyticsView,
  type PostSummaryItem,
} from "@/lib/post-analytics/query";
import {
  AccountAnalyticsOverviewSchema,
  AnalyticsModeSchema,
  AnalyticsPeriodSchema,
  AnalyticsSummarySchema,
  PostAnalyticsSchema,
  PostSummaryItemSchema,
} from "@/lib/post-analytics/schemas";
import {
  ensureAnalyticsRowsForUser,
  refreshAccountAnalytics,
  refreshAnalyticsForUser,
} from "@/lib/post-analytics/service";

import { platformLabel } from "../format";

/* ------------------------------------------------------------------------ */
/* Schemas                                                                   */
/* ------------------------------------------------------------------------ */

const RefreshSchema = z
  .enum(["auto", "none", "force"])
  .default("auto")
  .describe(
    "auto (default): refresh stale numbers from the platforms first (time-bounded). none: cached numbers only, fastest. force: re-read everything not read in the last two minutes — only when the user explicitly asks for the very latest numbers.",
  );

const filterShape = {
  period: AnalyticsPeriodSchema.default("last_30d"),
  from: z
    .string()
    .optional()
    .describe("Custom period start (YYYY-MM-DD or ISO datetime). Setting from/to makes the period custom."),
  to: z.string().optional().describe("Custom period end (YYYY-MM-DD is inclusive)."),
  timeZone: z
    .string()
    .optional()
    .describe("The user's IANA timezone (e.g. Europe/Berlin) for calendar periods, buckets and best posting times."),
  platforms: z.array(PlatformSchema).max(11).optional().describe("Only these platforms."),
  accountIds: z.array(z.string()).max(50).optional().describe("Only these connected account IDs from list_accounts."),
  mode: AnalyticsModeSchema.default("published"),
};

export const getPostAnalyticsSchema = z.object({
  postIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Exact SimplePost post IDs (from inspect_posts or list_post_analytics)."),
  refresh: RefreshSchema,
});

export const getPostAnalyticsOutputSchema = z.object({
  kind: z.literal("post_analytics"),
  posts: z.array(PostAnalyticsSchema),
  notFound: z.array(z.string()).describe("Post IDs that do not exist for this user."),
});

export const getAnalyticsSummarySchema = z.object({
  ...filterShape,
  compare: z.boolean().default(true).describe("Include the previous period of equal length and percentage changes."),
  granularity: z.enum(ANALYTICS_GRANULARITIES).optional().describe("Timeline bucket size (auto by default)."),
  topLimit: z.number().int().min(0).max(25).default(5).describe("How many top posts to include."),
  topSortBy: z.enum(SORTABLE_METRICS).default("engagements").describe("Metric used to rank top posts."),
  refresh: RefreshSchema,
});

export const getAnalyticsSummaryOutputSchema = z.object({
  kind: z.literal("analytics_summary"),
  summary: AnalyticsSummarySchema,
});

export const listPostAnalyticsSchema = z.object({
  ...filterShape,
  sortBy: z
    .enum(SORTABLE_METRICS)
    .default("engagements")
    .describe("Ranking metric: views, likes, comments, shares, engagements, engagementRate, publishedAt, …"),
  order: z.enum(["desc", "asc"]).default("desc").describe("desc = best first; asc = weakest first."),
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).default(1),
  refresh: RefreshSchema,
});

export const listPostAnalyticsOutputSchema = z.object({
  kind: z.literal("post_analytics_list"),
  period: AnalyticsSummarySchema.shape.period,
  mode: AnalyticsModeSchema,
  posts: z.array(PostSummaryItemSchema),
  pagination: z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() }),
});

export const getAccountAnalyticsSchema = z.object({ refresh: RefreshSchema });

export const getAccountAnalyticsOutputSchema = z.object({
  kind: z.literal("account_analytics"),
  accounts: z.array(AccountAnalyticsOverviewSchema),
});

/* ------------------------------------------------------------------------ */
/* Text formatting (model-facing)                                            */
/* ------------------------------------------------------------------------ */

const number = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "n/a"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
const change = (value: number | null | undefined) =>
  value === null || value === undefined
    ? ""
    : ` (${value >= 0 ? "+" : ""}${Math.round(value * 1000) / 10}% vs previous)`;
const date = (iso: string, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(iso));
const excerpt = (text: string) => {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat || "(no text)";
};

function metricList(metrics: PostMetrics): string {
  return (Object.keys(POST_METRIC_DEFINITIONS) as PostMetric[])
    .filter((metric) => metrics[metric] !== undefined)
    .map((metric) => {
      const value = metrics[metric]!;
      const formatted = POST_METRIC_DEFINITIONS[metric].unit === "seconds" ? `${number(value)}s` : number(value);
      return `${POST_METRIC_DEFINITIONS[metric].label.toLowerCase()} ${formatted}`;
    })
    .join(", ");
}

function totalsLine(totals: MetricTotals): string {
  const parts = [metricList(totals.metrics)];
  if (totals.engagements !== null) parts.push(`engagements ${number(totals.engagements)}`);
  if (totals.engagementRate !== null) parts.push(`engagement rate ${percent(totals.engagementRate)}`);
  return parts.filter(Boolean).join(", ") || "no metrics yet";
}

export function formatPostAnalytics(view: PostAnalyticsView): string {
  if (view.notPublished) return `Post ${view.postId}: not published to any account yet, so it has no analytics.`;
  const lines = [
    `Post ${view.postId}${view.publishedAt ? ` (published ${date(view.publishedAt)})` : ""}: ${totalsLine(view.totals)}.`,
  ];
  for (const account of view.accounts) {
    const who = `${platformLabel(account.platform)}${account.username ? ` @${account.username.replace(/^@/, "")}` : ""}`;
    const metrics = metricList(account.metrics);
    lines.push(
      `- ${who}: ${account.status === "ok" ? metrics || "no metrics yet" : `${account.status}${metrics ? ` (last known: ${metrics})` : ""}`}${
        account.message ? ` — ${account.message}` : ""
      }${account.postUrl ? ` ${account.postUrl}` : ""}`,
    );
  }
  if (view.lastUpdatedAt) lines.push(`Updated ${view.lastUpdatedAt}.`);
  return lines.join("\n");
}

function postLine(post: PostSummaryItem, index: number, timeZone: string): string {
  return `${index + 1}. "${excerpt(post.message)}" (${date(post.publishedAt, timeZone)}, ${post.platforms
    .map((platform) => platformLabel(platform))
    .join(" + ")}) — ${totalsLine(post)} [postId ${post.postId}]`;
}

const PERIOD_LABELS: Record<string, string> = {
  last_24h: "the last 24 hours",
  last_7d: "the last 7 days",
  last_30d: "the last 30 days",
  last_90d: "the last 90 days",
  last_365d: "the last 12 months",
  today: "today",
  yesterday: "yesterday",
  this_week: "this week",
  last_week: "last week",
  this_month: "this month",
  last_month: "last month",
  this_quarter: "this quarter",
  last_quarter: "last quarter",
  this_year: "this year",
  last_year: "last year",
  all_time: "all time",
  custom: "a custom period",
};

export function formatSummary(summary: AnalyticsSummary): string {
  const { period } = summary;
  const label = PERIOD_LABELS[period.key] ?? period.key;
  const lines = [
    `Analytics for ${label} (${date(period.start, period.timeZone)} – ${date(new Date(new Date(period.end).getTime() - 1).toISOString(), period.timeZone)}, ${period.timeZone}); ${
      summary.mode === "published"
        ? "lifetime metrics of posts published in the period"
        : "metrics gained during the period (approximate)"
    }.`,
    `Posts: ${summary.totals.posts}${change(summary.change?.posts)} across ${summary.totals.publications} publications.`,
    `Views: ${number(summary.totals.metrics.views)}${change(summary.change?.views)}. Engagements: ${number(summary.totals.engagements)}${change(
      summary.change?.engagements,
    )}. Engagement rate: ${percent(summary.totals.engagementRate)}.`,
    `All metrics: ${totalsLine(summary.totals)}.`,
  ];
  if (summary.byPlatform.length > 0) {
    lines.push("By platform:");
    for (const platform of summary.byPlatform)
      lines.push(
        `- ${platformLabel(platform.platform)}: ${platform.posts} posts, ${totalsLine(platform)}${
          platform.share === null ? "" : `, ${percent(platform.share)} of engagement`
        }`,
      );
  }
  if (summary.topPosts.length > 0) {
    lines.push("Top posts:");
    summary.topPosts.forEach((post, index) => lines.push(postLine(post, index, period.timeZone)));
  }
  if (summary.followers.length > 0) {
    lines.push(
      `Followers: ${summary.followers
        .map(
          (entry) =>
            `${platformLabel(entry.platform)}${entry.username ? ` @${entry.username.replace(/^@/, "")}` : ""} ${number(entry.current)}${
              entry.change ? ` (${entry.change > 0 ? "+" : ""}${number(entry.change)})` : ""
            }`,
        )
        .join("; ")}.`,
    );
  }
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const bestDay = [...summary.bestTimes.byWeekday]
    .filter((bucket) => bucket.averageEngagements !== null)
    .sort((a, b) => b.averageEngagements! - a.averageEngagements!)[0];
  const bestHour = [...summary.bestTimes.byHour]
    .filter((bucket) => bucket.averageEngagements !== null && bucket.posts >= 2)
    .sort((a, b) => b.averageEngagements! - a.averageEngagements!)[0];
  if (bestDay && summary.totals.posts >= 3)
    lines.push(
      `Best publishing time in this period: ${weekdays[bestDay.weekday]}${bestHour ? ` around ${bestHour.hour}:00` : ""} (${period.timeZone}).`,
    );
  if (summary.coverage.pending > 0 || summary.coverage.unavailable > 0)
    lines.push(
      `Coverage: numbers for ${summary.coverage.withData} of ${summary.coverage.publications} publications (${summary.coverage.pending} not read yet, ${summary.coverage.unavailable} unavailable).`,
    );
  for (const notice of summary.notices)
    lines.push(
      `Note (${platformLabel(notice.platform)}${notice.username ? ` @${notice.username}` : ""}): ${notice.message}${
        notice.reconnectRecommended ? " The user can reconnect the account in the SimplePost web app." : ""
      }`,
    );
  return lines.join("\n");
}

function formatAccounts(accounts: AccountAnalyticsOverview[]): string {
  if (accounts.length === 0) return "No connected accounts.";
  return accounts
    .map((account) => {
      const who = `${platformLabel(account.platform)}${account.username ? ` @${account.username.replace(/^@/, "")}` : ""}`;
      const metrics = Object.entries(account.metrics)
        .map(([name, value]) => `${name} ${number(value)}`)
        .join(", ");
      const notes = [
        account.postAnalytics ? null : "post analytics unavailable",
        account.reconnectRecommended ? "reconnect to unlock more analytics" : null,
        account.notice,
      ].filter(Boolean);
      return `- ${who} [${account.accountId}]: ${metrics || "no account metrics yet"}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
    })
    .join("\n");
}

/* ------------------------------------------------------------------------ */
/* Handlers                                                                  */
/* ------------------------------------------------------------------------ */

type RefreshMode = z.infer<typeof RefreshSchema>;

async function shouldRefresh(userId: string, refresh: RefreshMode, readOnly?: boolean): Promise<boolean> {
  return refresh !== "none" && !readOnly && (await canRefreshAnalytics(userId));
}

export async function getPostAnalyticsTool(
  userId: string,
  input: z.infer<typeof getPostAnalyticsSchema>,
  options: { readOnly?: boolean } = {},
) {
  const postIds = [...new Set(input.postIds)];
  await ((await shouldRefresh(userId, input.refresh, options.readOnly))
    ? refreshAnalyticsForUser(userId, {
        postIds,
        force: input.refresh === "force",
        budgetMs: 20_000,
        accounts: false,
      })
    : ensureAnalyticsRowsForUser(userId, { postIds }));
  const views = await Promise.all(postIds.map((postId) => getPostAnalyticsView(userId, postId)));
  const posts = views.filter((view): view is PostAnalyticsView => view !== null);
  const result = {
    kind: "post_analytics" as const,
    posts,
    notFound: postIds.filter((_, index) => views[index] === null),
  };
  const text = [
    ...posts.map((view) => formatPostAnalytics(view)),
    ...(result.notFound.length > 0 ? [`Not found: ${result.notFound.join(", ")}.`] : []),
  ].join("\n\n");
  return { result, text };
}

function sinceFor(input: {
  period: string;
  from?: string;
  to?: string;
  timeZone?: string;
  mode?: string;
}): Date | undefined {
  // Activity counts gains on older posts too, so their numbers must be refreshed as well.
  if (input.mode === "activity" || (input.period === "all_time" && !input.from)) return undefined;
  return resolvePeriod(input as Parameters<typeof resolvePeriod>[0]).start;
}

export async function getAnalyticsSummaryTool(
  userId: string,
  input: z.infer<typeof getAnalyticsSummarySchema>,
  options: { readOnly?: boolean } = {},
) {
  const since = sinceFor(input);
  await ((await shouldRefresh(userId, input.refresh, options.readOnly))
    ? refreshAnalyticsForUser(userId, {
        since,
        force: input.refresh === "force",
        budgetMs: 20_000,
        platforms: input.platforms,
      })
    : ensureAnalyticsRowsForUser(userId, { since }));
  const summary = await getAnalyticsSummary(userId, { ...input, accountIds: input.accountIds });
  return { result: { kind: "analytics_summary" as const, summary }, text: formatSummary(summary) };
}

export async function listPostAnalyticsTool(
  userId: string,
  input: z.infer<typeof listPostAnalyticsSchema>,
  options: { readOnly?: boolean } = {},
) {
  const since = sinceFor(input);
  await ((await shouldRefresh(userId, input.refresh, options.readOnly))
    ? refreshAnalyticsForUser(userId, {
        since,
        force: input.refresh === "force",
        budgetMs: 20_000,
        accounts: false,
        platforms: input.platforms,
      })
    : ensureAnalyticsRowsForUser(userId, { since }));
  const list = await listPostAnalytics(userId, input);
  const offset = (list.pagination.page - 1) * list.pagination.limit;
  const text =
    list.posts.length === 0
      ? "No published posts in this period."
      : [
          `Posts ranked by ${input.sortBy} (${input.order === "desc" ? "highest first" : "lowest first"}), page ${list.pagination.page} of ${list.pagination.totalPages}, ${list.pagination.total} posts:`,
          ...list.posts.map((post, index) => postLine(post, offset + index, list.period.timeZone)),
        ].join("\n");
  return { result: { kind: "post_analytics_list" as const, ...list }, text };
}

export async function getAccountAnalyticsTool(
  userId: string,
  input: z.infer<typeof getAccountAnalyticsSchema>,
  options: { readOnly?: boolean } = {},
) {
  if (await shouldRefresh(userId, input.refresh, options.readOnly)) {
    await refreshAccountAnalytics({ userId, force: input.refresh === "force", reason: "manual" });
  }
  const accounts = await getAccountsAnalytics(userId);
  return { result: { kind: "account_analytics" as const, accounts }, text: formatAccounts(accounts) };
}
