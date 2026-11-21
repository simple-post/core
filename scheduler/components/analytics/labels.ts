"use client";

import { useMemo } from "react";

import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { AnalyticsPeriod } from "@/lib/post-analytics/periods";

import type { AccountMetric, PostMetric } from "@simple-post/sdk/analytics";

export type MetricKey = PostMetric | "engagements" | "engagementRate" | "posts" | "publishedAt";

/** Localized labels for metrics and periods. Literal copy() calls keep them in the translation catalog. */
export function useAnalyticsLabels() {
  const { copy } = useUiCopy();
  return useMemo(() => {
    const metric: Record<MetricKey, string> = {
      views: copy("Views"),
      reach: copy("Reach"),
      likes: copy("Likes"),
      comments: copy("Comments"),
      shares: copy("Shares"),
      quotes: copy("Quotes"),
      saves: copy("Saves"),
      clicks: copy("Clicks"),
      profileVisits: copy("Profile visits"),
      follows: copy("Follows"),
      watchTimeSeconds: copy("Watch time"),
      averageWatchTimeSeconds: copy("Avg. watch time"),
      engagements: copy("Engagements"),
      engagementRate: copy("Engagement rate"),
      posts: copy("Posts"),
      publishedAt: copy("Newest"),
    };
    const metricHelp: Partial<Record<MetricKey, string>> = {
      views: copy("Times your posts were shown or played (impressions, views or plays, depending on the platform)."),
      reach: copy("Unique accounts that saw your posts."),
      engagements: copy("Likes, comments, shares, quotes and saves combined."),
      engagementRate: copy("Engagements divided by views (or reach) on posts that report both."),
      shares: copy("Reposts, retweets, shares and forwards."),
      clicks: copy("Link, outbound and pin clicks."),
    };
    const accountMetric: Record<AccountMetric, string> = {
      followers: copy("Followers"),
      following: copy("Following"),
      posts: copy("Posts"),
      totalViews: copy("Total views"),
      totalLikes: copy("Total likes"),
    };
    const period: Record<Exclude<AnalyticsPeriod, "custom">, string> = {
      last_24h: copy("Last 24 hours"),
      last_7d: copy("Last 7 days"),
      last_30d: copy("Last 30 days"),
      last_90d: copy("Last 90 days"),
      last_365d: copy("Last 12 months"),
      today: copy("Today"),
      yesterday: copy("Yesterday"),
      this_week: copy("This week"),
      last_week: copy("Last week"),
      this_month: copy("This month"),
      last_month: copy("Last month"),
      this_quarter: copy("This quarter"),
      last_quarter: copy("Last quarter"),
      this_year: copy("This year"),
      last_year: copy("Last year"),
      all_time: copy("All time"),
    };
    const shortPeriod: Partial<Record<AnalyticsPeriod, string>> = {
      last_24h: copy("24h"),
      last_7d: copy("7d"),
      last_30d: copy("30d"),
      last_90d: copy("90d"),
      last_365d: copy("12m"),
    };
    const status: Record<string, string> = {
      ok: copy("Up to date"),
      pending: copy("Waiting for first read"),
      not_found: copy("Post not found"),
      unsupported: copy("Not available"),
      missing_permission: copy("Permission needed"),
      rate_limited: copy("Rate limited"),
      credentials_error: copy("Reconnect needed"),
      error: copy("Could not read"),
    };
    return { metric, metricHelp, accountMetric, period, shortPeriod, status };
  }, [copy]);
}
