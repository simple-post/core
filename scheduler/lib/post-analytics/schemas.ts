import { PlatformSchema } from "@simple-post/sdk";
import { ACCOUNT_METRICS, POST_METRICS } from "@simple-post/sdk/analytics";
import * as z from "zod";

import { ANALYTICS_GRANULARITIES, ANALYTICS_PERIODS } from "./periods";
import { SORTABLE_METRICS } from "./query";

/* ------------------------------------------------------------------------ */
/* Requests                                                                  */
/* ------------------------------------------------------------------------ */

export const AnalyticsPeriodSchema = z
  .enum(ANALYTICS_PERIODS)
  .describe(
    "Reporting period. Rolling: last_24h, last_7d, last_8d, last_30d, last_90d, last_365d. Calendar (in timeZone): today, yesterday, this_week, last_week (Monday-based), this_month, last_month, this_quarter, last_quarter, this_year, last_year. Also all_time, or custom with from/to.",
  );

export const AnalyticsModeSchema = z
  .enum(["published", "activity"])
  .describe(
    "published (default): lifetime metrics of posts published in the period. activity: metrics gained during the period by any post, from stored snapshots (approximate).",
  );

const booleanParam = z.preprocess(
  (value) => (value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : value),
  z.boolean(),
);

const listParam = z.preprocess(
  (value) =>
    value === undefined
      ? undefined
      : (Array.isArray(value) ? value : [value]).flatMap((entry) => String(entry).split(",")).filter(Boolean),
  z.array(z.string()).max(50),
);

export const AnalyticsRefreshModeSchema = z
  .enum(["none", "auto", "force"])
  .describe(
    "none: cached values only (fast). auto: first refresh stale values from the platforms (bounded time). force: refresh everything that was not read in the last two minutes.",
  );

export const analyticsFilterShape = {
  period: AnalyticsPeriodSchema.optional(),
  from: z.string().optional().describe("Custom period start: YYYY-MM-DD (local midnight) or ISO 8601 datetime."),
  to: z.string().optional().describe("Custom period end: YYYY-MM-DD (inclusive day) or ISO 8601 datetime (exclusive)."),
  timeZone: z.string().optional().describe("IANA timezone for calendar periods and buckets, e.g. Europe/Berlin."),
  granularity: z
    .enum(ANALYTICS_GRANULARITIES)
    .optional()
    .describe("Timeline bucket size; chosen from the period length by default."),
  platform: listParam.optional().describe("Only these platforms (repeat or comma-separate)."),
  accountId: listParam.optional().describe("Only these connected account IDs (repeat or comma-separate)."),
  mode: AnalyticsModeSchema.optional(),
};

export const analyticsSummaryQuerySchema = z.object({
  ...analyticsFilterShape,
  compare: booleanParam.optional().describe("Compare with the previous period of the same length (default true)."),
  topLimit: z.coerce.number().int().min(0).max(50).optional().describe("Number of top posts to include (default 10)."),
  topSortBy: z.enum(SORTABLE_METRICS).optional().describe("Metric used to rank top posts (default engagements)."),
  refresh: AnalyticsRefreshModeSchema.optional(),
});

export const analyticsPostsQuerySchema = z.object({
  ...analyticsFilterShape,
  sortBy: z
    .enum(SORTABLE_METRICS)
    .optional()
    .describe("Sort key (default publishedAt, or engagements in activity mode)."),
  order: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  refresh: AnalyticsRefreshModeSchema.optional(),
});

export const analyticsRefreshRequestSchema = z.object({
  postIds: z.array(z.string()).max(100).optional().describe("Refresh only these SimplePost posts."),
  period: AnalyticsPeriodSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  timeZone: z.string().optional(),
  mode: AnalyticsModeSchema.optional().describe("activity refreshes older posts too, since their gains count."),
  platforms: z.array(PlatformSchema).max(11).optional().describe("Only refresh these platforms."),
  force: z.boolean().optional().describe("Ignore cache freshness (still at most once per two minutes per post)."),
});

/** Turns URLSearchParams into a plain object, keeping repeated keys as arrays. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* Responses                                                                 */
/* ------------------------------------------------------------------------ */

const metricNumbers = Object.fromEntries(POST_METRICS.map((metric) => [metric, z.number().optional()])) as Record<
  (typeof POST_METRICS)[number],
  z.ZodOptional<z.ZodNumber>
>;

export const PostMetricsSchema = z
  .object(metricNumbers)
  .describe("Comparable metrics. A missing metric is not reported by the platform; 0 means none yet.")
  .meta({ id: "PostMetrics" });

const MetricTotalsShape = {
  metrics: PostMetricsSchema,
  engagements: z.number().nullable().describe("likes + comments + shares + quotes + saves"),
  engagementRate: z.number().nullable().describe("engagements ÷ views (or reach), 0–1"),
};

export const PostAnalyticsAccountSchema = z
  .object({
    ...MetricTotalsShape,
    accountId: z.string(),
    platform: PlatformSchema,
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    platformPostId: z.string(),
    postUrl: z.string().nullable(),
    status: z
      .string()
      .describe("ok, pending, not_found, unsupported, missing_permission, rate_limited, credentials_error or error"),
    message: z.string().nullable(),
    platformMetrics: z.record(z.string(), z.number()).describe("Native platform metrics under their own names."),
    supportedMetrics: z.array(z.enum(POST_METRICS)),
    fetchedAt: z.string().nullable(),
    nextRefreshAt: z.string().nullable(),
    isStale: z.boolean(),
    reconnectRecommended: z.boolean(),
  })
  .meta({ id: "PostAnalyticsAccount" });

export const PostAnalyticsSchema = z
  .object({
    postId: z.string(),
    status: z.string(),
    publishedAt: z.string().nullable(),
    totals: z.object(MetricTotalsShape),
    accounts: z.array(PostAnalyticsAccountSchema),
    history: z.array(z.object({ at: z.string(), ...MetricTotalsShape })),
    lastUpdatedAt: z.string().nullable(),
    isStale: z.boolean(),
    notPublished: z.boolean(),
  })
  .meta({ id: "PostAnalytics" });

export const PostAnalyticsEnvelopeSchema = z
  .object({ analytics: PostAnalyticsSchema })
  .meta({ id: "PostAnalyticsEnvelope" });

const PeriodSchema = z.object({
  key: AnalyticsPeriodSchema,
  start: z.string(),
  end: z.string(),
  timeZone: z.string(),
  granularity: z.enum(ANALYTICS_GRANULARITIES),
  previous: z.object({ start: z.string(), end: z.string() }).nullable(),
});

export const PostSummaryItemSchema = z
  .object({
    ...MetricTotalsShape,
    postId: z.string(),
    teamPostId: z.string().optional(),
    teamWorkspaceId: z.string().optional(),
    message: z.string(),
    publishedAt: z.string(),
    platforms: z.array(PlatformSchema),
    accounts: z.array(
      z.object({
        accountId: z.string(),
        platform: PlatformSchema,
        username: z.string().nullable(),
        postUrl: z.string().nullable(),
        status: z.string(),
      }),
    ),
    thumbnailUrl: z.string().nullable(),
    mediaType: z.enum(["image", "video"]).nullable(),
  })
  .meta({ id: "PostAnalyticsSummaryItem" });

const TotalsWithCountsSchema = z.object({
  ...MetricTotalsShape,
  posts: z.number().describe("Distinct SimplePost posts."),
  publications: z.number().describe("Post × account publications."),
});

export const AnalyticsSummarySchema = z
  .object({
    period: PeriodSchema,
    mode: AnalyticsModeSchema,
    filters: z.object({ platforms: z.array(z.string()), accountIds: z.array(z.string()) }),
    totals: TotalsWithCountsSchema,
    previous: TotalsWithCountsSchema.nullable(),
    change: z
      .record(z.string(), z.number().nullable())
      .nullable()
      .describe("Relative change vs previous period (0.25 = +25%); engagementRate is the absolute difference."),
    byPlatform: z.array(
      z.object({
        ...MetricTotalsShape,
        platform: PlatformSchema,
        posts: z.number(),
        accounts: z.number(),
        supportedMetrics: z.array(z.enum(POST_METRICS)),
        share: z.number().nullable().describe("Share of all engagements."),
      }),
    ),
    byAccount: z.array(
      z.object({
        ...MetricTotalsShape,
        accountId: z.string(),
        platform: PlatformSchema,
        username: z.string().nullable(),
        displayName: z.string().nullable(),
        profilePicture: z.string().nullable(),
        posts: z.number(),
        followers: z.number().nullable(),
        followersChange: z.number().nullable(),
      }),
    ),
    timeline: z.array(z.object({ start: z.string(), posts: z.number(), ...MetricTotalsShape })),
    topPosts: z.array(PostSummaryItemSchema),
    platforms: z.array(PlatformSchema),
    bestTimes: z.object({
      bySlot: z.array(
        z.object({
          weekday: z.number(),
          hour: z.number(),
          posts: z.number(),
          averageEngagements: z.number().nullable(),
        }),
      ),
      byWeekday: z.array(
        z.object({
          weekday: z.number().describe("0 = Monday … 6 = Sunday"),
          posts: z.number(),
          averageEngagements: z.number().nullable(),
        }),
      ),
      byHour: z.array(z.object({ hour: z.number(), posts: z.number(), averageEngagements: z.number().nullable() })),
    }),
    followers: z.array(
      z.object({
        accountId: z.string(),
        platform: PlatformSchema,
        username: z.string().nullable(),
        current: z.number().nullable(),
        change: z.number().nullable(),
        series: z.array(z.object({ day: z.string(), followers: z.number() })),
        baseline: z.object({ day: z.string(), followers: z.number() }).optional(),
      }),
    ),
    coverage: z.object({
      publications: z.number(),
      withData: z.number(),
      pending: z.number(),
      unavailable: z.number(),
      stale: z.number(),
      lastUpdatedAt: z.string().nullable(),
    }),
    notices: z.array(
      z.object({
        accountId: z.string(),
        platform: PlatformSchema,
        username: z.string().nullable(),
        message: z.string(),
        reconnectRecommended: z.boolean(),
      }),
    ),
  })
  .meta({ id: "AnalyticsSummary" });

export const AnalyticsSummaryEnvelopeSchema = z
  .object({ summary: AnalyticsSummarySchema })
  .meta({ id: "AnalyticsSummaryEnvelope" });

export const AnalyticsPostsEnvelopeSchema = z
  .object({
    period: PeriodSchema,
    mode: AnalyticsModeSchema,
    posts: z.array(PostSummaryItemSchema),
    pagination: z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() }),
  })
  .meta({ id: "AnalyticsPostsEnvelope" });

export const AccountAnalyticsOverviewSchema = z
  .object({
    accountId: z.string(),
    platform: PlatformSchema,
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    profilePicture: z.string().nullable(),
    status: z.string().nullable(),
    message: z.string().nullable(),
    metrics: z.object(
      Object.fromEntries(ACCOUNT_METRICS.map((metric) => [metric, z.number().optional()])) as Record<
        (typeof ACCOUNT_METRICS)[number],
        z.ZodOptional<z.ZodNumber>
      >,
    ),
    capturedAt: z.string().nullable(),
    postAnalytics: z.boolean(),
    accountAnalytics: z.boolean(),
    reconnectRecommended: z.boolean(),
    notice: z.string().nullable(),
    supportedMetrics: z.array(z.enum(POST_METRICS)),
    supportedAccountMetrics: z.array(z.enum(ACCOUNT_METRICS)),
  })
  .meta({ id: "AccountAnalyticsOverview" });

export const AccountAnalyticsEnvelopeSchema = z
  .object({ accounts: z.array(AccountAnalyticsOverviewSchema) })
  .meta({ id: "AccountAnalyticsEnvelope" });

export const AnalyticsRefreshResponseSchema = z
  .object({
    posts: z.object({ refreshed: z.number(), succeeded: z.number(), failed: z.number(), skipped: z.number() }),
    accounts: z.number(),
  })
  .meta({ id: "AnalyticsRefreshResponse" });
