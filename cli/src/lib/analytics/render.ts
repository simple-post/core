import { POST_METRIC_DEFINITIONS, type PostAnalytics, type PostMetric, type PostMetrics } from "@simple-post/sdk";

import type { Colors } from "../ux/colors.js";

/** Subset of the Scheduler API responses the CLI renders. */
export interface MetricTotals {
  metrics: PostMetrics;
  engagements: number | null;
  engagementRate: number | null;
}

export interface SummaryPost extends MetricTotals {
  postId: string;
  message: string;
  publishedAt: string;
  platforms: string[];
}

export interface AnalyticsSummaryResponse {
  summary: {
    period: { key: string; start: string; end: string; timeZone: string };
    mode: "published" | "activity";
    totals: MetricTotals & { posts: number; publications: number };
    change: Record<string, number | null> | null;
    byPlatform: Array<MetricTotals & { platform: string; posts: number; share: number | null }>;
    topPosts: SummaryPost[];
    followers: Array<{ platform: string; username: string | null; current: number | null; change: number | null }>;
    bestTimes: {
      byWeekday: Array<{ weekday: number; posts: number; averageEngagements: number | null }>;
      byHour: Array<{ hour: number; posts: number; averageEngagements: number | null }>;
    };
    coverage: {
      publications: number;
      withData: number;
      pending: number;
      unavailable: number;
      lastUpdatedAt: string | null;
    };
    notices: Array<{ platform: string; username: string | null; message: string; reconnectRecommended: boolean }>;
  };
}

export interface AnalyticsPostsResponse {
  posts: SummaryPost[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface PostAnalyticsResponse {
  analytics: {
    postId: string;
    publishedAt: string | null;
    totals: MetricTotals;
    notPublished: boolean;
    lastUpdatedAt: string | null;
    accounts: Array<
      MetricTotals & {
        platform: string;
        username: string | null;
        status: string;
        message: string | null;
        postUrl: string | null;
        platformMetrics: Record<string, number>;
      }
    >;
  };
}

export interface AccountAnalyticsResponse {
  accounts: Array<{
    accountId: string;
    platform: string;
    username: string | null;
    metrics: Record<string, number>;
    capturedAt: string | null;
    postAnalytics: boolean;
    reconnectRecommended: boolean;
    notice: string | null;
  }>;
}

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  bluesky: "Bluesky",
  threads: "Threads",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  forem: "DEV/Forem",
  telegram: "Telegram",
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 10_000)
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
}

function formatChange(colors: Colors, value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = `${value >= 0 ? "+" : ""}${Math.round(value * 1000) / 10}%`;
  return value > 0 ? colors.lime(` ${text}`) : value < 0 ? colors.red(` ${text}`) : colors.dim(` ${text}`);
}

function metricValue(metric: PostMetric, value: number): string {
  return POST_METRIC_DEFINITIONS[metric].unit === "seconds" ? `${formatNumber(value)}s` : formatNumber(value);
}

export function formatMetrics(metrics: PostMetrics): string {
  return (Object.keys(POST_METRIC_DEFINITIONS) as PostMetric[])
    .filter((metric) => metrics[metric] !== undefined)
    .map((metric) => `${POST_METRIC_DEFINITIONS[metric].label} ${metricValue(metric, metrics[metric]!)}`)
    .join(" · ");
}

function excerpt(text: string, length = 60): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat || "(no text)";
}

function pad(text: string, width: number, align: "start" | "end" = "start"): string {
  return align === "end" ? text.padStart(width) : text.padEnd(width);
}

export function renderSummary(response: AnalyticsSummaryResponse, colors: Colors): string {
  const { summary } = response;
  const day = (iso: string) => iso.slice(0, 10);
  const end = new Date(new Date(summary.period.end).getTime() - 1).toISOString();
  const lines = [
    colors.bold(`Analytics · ${summary.period.key.replaceAll("_", " ")}`) +
      colors.dim(
        ` (${day(summary.period.start)} – ${day(end)}, ${summary.period.timeZone}, ${
          summary.mode === "published" ? "posts published in period" : "activity in period"
        })`,
      ),
    "",
    `  Posts        ${pad(formatNumber(summary.totals.posts), 10, "end")}${formatChange(colors, summary.change?.posts)}`,
    `  Views        ${pad(formatNumber(summary.totals.metrics.views), 10, "end")}${formatChange(colors, summary.change?.views)}`,
    `  Engagements  ${pad(formatNumber(summary.totals.engagements), 10, "end")}${formatChange(colors, summary.change?.engagements)}`,
    `  Eng. rate    ${pad(formatRate(summary.totals.engagementRate), 10, "end")}`,
  ];
  const detail = formatMetrics(summary.totals.metrics);
  if (detail) lines.push(colors.dim(`  ${detail}`));

  if (summary.byPlatform.length > 0) {
    lines.push("", colors.bold("By platform"));
    for (const platform of summary.byPlatform)
      lines.push(
        `  ${pad(platformLabel(platform.platform), 11)} ${pad(`${platform.posts} posts`, 10)} views ${pad(formatNumber(platform.metrics.views), 7, "end")}  engagements ${pad(formatNumber(platform.engagements), 7, "end")}  rate ${pad(formatRate(platform.engagementRate), 6, "end")}`,
      );
  }

  if (summary.topPosts.length > 0) {
    lines.push("", colors.bold("Top posts"));
    for (const [index, post] of summary.topPosts.entries())
      lines.push(
        `  ${index + 1}. ${excerpt(post.message)} ${colors.dim(`(${post.platforms.map(platformLabel).join(", ")}, ${day(post.publishedAt)})`)}`,
        `     ${formatMetrics(post.metrics) || "no metrics yet"}${post.engagements === null ? "" : ` · Engagements ${formatNumber(post.engagements)}`} ${colors.dim(post.postId)}`,
      );
  }

  if (summary.followers.length > 0) {
    lines.push("", colors.bold("Followers"));
    for (const entry of summary.followers)
      lines.push(
        `  ${pad(platformLabel(entry.platform), 11)} ${pad(entry.username ? `@${entry.username.replace(/^@/, "")}` : "", 24)} ${pad(formatNumber(entry.current), 8, "end")}${
          entry.change
            ? entry.change > 0
              ? colors.lime(` +${formatNumber(entry.change)}`)
              : colors.red(` ${formatNumber(entry.change)}`)
            : ""
        }`,
      );
  }

  const bestDay = [...summary.bestTimes.byWeekday]
    .filter((bucket) => bucket.averageEngagements !== null)
    .sort((a, b) => b.averageEngagements! - a.averageEngagements!)[0];
  const bestHour = [...summary.bestTimes.byHour]
    .filter((bucket) => bucket.averageEngagements !== null && bucket.posts >= 2)
    .sort((a, b) => b.averageEngagements! - a.averageEngagements!)[0];
  if (bestDay && summary.totals.posts >= 3)
    lines.push(
      "",
      `Best time to post: ${WEEKDAYS[bestDay.weekday]}${bestHour ? ` around ${String(bestHour.hour).padStart(2, "0")}:00` : ""} ${colors.dim(`(${summary.period.timeZone})`)}`,
    );

  for (const notice of summary.notices)
    lines.push(
      colors.dim(
        `Note: ${platformLabel(notice.platform)}${notice.username ? ` @${notice.username}` : ""} — ${notice.message}${
          notice.reconnectRecommended ? " Reconnect it in the SimplePost web app." : ""
        }`,
      ),
    );
  if (summary.coverage.pending > 0)
    lines.push(
      colors.dim(`${summary.coverage.pending} publications have not been read yet; run again with --refresh auto.`),
    );
  return lines.join("\n");
}

export function renderPostList(response: AnalyticsPostsResponse, sortBy: string, colors: Colors): string {
  if (response.posts.length === 0) return "No published posts in this period.";
  const offset = (response.pagination.page - 1) * response.pagination.limit;
  const lines = [
    colors.bold(`Posts by ${sortBy}`) +
      colors.dim(
        ` (page ${response.pagination.page} of ${response.pagination.totalPages}, ${response.pagination.total} posts)`,
      ),
  ];
  for (const [index, post] of response.posts.entries())
    lines.push(
      `${pad(String(offset + index + 1), 3, "end")}. ${excerpt(post.message)} ${colors.dim(`(${post.platforms.map(platformLabel).join(", ")}, ${post.publishedAt.slice(0, 10)})`)}`,
      `     ${formatMetrics(post.metrics) || "no metrics yet"}${post.engagements === null ? "" : ` · Engagements ${formatNumber(post.engagements)}`}${
        post.engagementRate === null ? "" : ` · Rate ${formatRate(post.engagementRate)}`
      } ${colors.dim(post.postId)}`,
    );
  return lines.join("\n");
}

export function renderPostAnalytics(response: PostAnalyticsResponse, colors: Colors, showNative = false): string {
  const { analytics } = response;
  if (analytics.notPublished) return `Post ${analytics.postId} has not been published to any account yet.`;
  const lines = [
    colors.bold(`Post ${analytics.postId}`) +
      (analytics.publishedAt
        ? colors.dim(` (published ${analytics.publishedAt.slice(0, 16).replace("T", " ")} UTC)`)
        : ""),
    `  Total: ${formatMetrics(analytics.totals.metrics) || "no metrics yet"}${
      analytics.totals.engagements === null ? "" : ` · Engagements ${formatNumber(analytics.totals.engagements)}`
    }${analytics.totals.engagementRate === null ? "" : ` · Rate ${formatRate(analytics.totals.engagementRate)}`}`,
  ];
  for (const account of analytics.accounts) {
    const who = `${platformLabel(account.platform)}${account.username ? ` @${account.username.replace(/^@/, "")}` : ""}`;
    const status = account.status === "ok" ? colors.lime("●") : colors.dim("○");
    lines.push(`  ${status} ${who}: ${formatMetrics(account.metrics) || colors.dim(account.status)}`);
    if (account.message) lines.push(colors.dim(`      ${account.message}`));
    if (account.postUrl) lines.push(colors.dim(`      ${account.postUrl}`));
    if (showNative)
      for (const [name, value] of Object.entries(account.platformMetrics))
        lines.push(colors.dim(`      ${name}: ${value}`));
  }
  if (analytics.lastUpdatedAt) lines.push(colors.dim(`Updated ${analytics.lastUpdatedAt}`));
  return lines.join("\n");
}

export function renderLocalPostAnalytics(
  results: Array<{ accountAlias: string; result: PostAnalytics }>,
  colors: Colors,
  showNative = false,
): string {
  const lines: string[] = [];
  for (const { accountAlias, result } of results) {
    const status = result.status === "ok" ? colors.lime("●") : colors.red("○");
    lines.push(
      `${status} ${platformLabel(result.platform)} · ${accountAlias} · ${result.postId}`,
      result.status === "ok" ? `    ${formatMetrics(result.metrics) || "no metrics reported"}` : `    ${result.status}`,
    );
    if (result.message) lines.push(colors.dim(`    ${result.message}`));
    if (showNative)
      for (const [name, value] of Object.entries(result.platformMetrics ?? {}))
        lines.push(colors.dim(`    ${name}: ${value}`));
  }
  return lines.join("\n");
}

export function renderAccounts(response: AccountAnalyticsResponse, colors: Colors): string {
  if (response.accounts.length === 0) return "No connected accounts.";
  return response.accounts
    .map((account) => {
      const who = `${platformLabel(account.platform)}${account.username ? ` @${account.username.replace(/^@/, "")}` : ""}`;
      const metrics = Object.entries(account.metrics)
        .map(([name, value]) => `${name} ${formatNumber(value)}`)
        .join(" · ");
      const notes = [
        account.postAnalytics ? null : "post analytics unavailable",
        account.reconnectRecommended ? "reconnect to unlock more analytics" : null,
      ].filter(Boolean);
      return `${pad(who, 34)} ${metrics || colors.dim("no account metrics yet")}${notes.length > 0 ? colors.dim(` (${notes.join("; ")})`) : ""}`;
    })
    .join("\n");
}
