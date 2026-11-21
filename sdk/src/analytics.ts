/**
 * Unified post and account analytics model shared by every SimplePost
 * surface (SDK, HTTP server, scheduler, MCP, CLI). Browser-safe: no Node
 * imports, so the scheduler UI can import it via `@simple-post/sdk/analytics`.
 *
 * Platforms expose very different statistics. SimplePost maps each native
 * metric onto a small, comparable vocabulary and keeps everything else in
 * `platformMetrics` under the platform's own name. A metric that a platform
 * cannot report is *absent* (undefined), never 0, so consumers can tell "no
 * likes yet" from "this platform doesn't report likes".
 */

import type { Platform } from "./types/post";

/** Comparable per-post metrics. */
export const POST_METRICS = [
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
] as const;
export type PostMetric = (typeof POST_METRICS)[number];

/** Metrics that are summed into the derived `engagements` value. */
export const ENGAGEMENT_METRICS = [
  "likes",
  "comments",
  "shares",
  "quotes",
  "saves",
] as const satisfies readonly PostMetric[];

/** Metrics that can be meaningfully summed across posts (averages cannot). */
export const ADDITIVE_POST_METRICS = POST_METRICS.filter(
  (metric): metric is Exclude<PostMetric, "averageWatchTimeSeconds"> => metric !== "averageWatchTimeSeconds",
);

export type PostMetrics = Partial<Record<PostMetric, number>>;

/** Comparable account-level metrics. */
export const ACCOUNT_METRICS = ["followers", "following", "posts", "totalViews", "totalLikes"] as const;
export type AccountMetric = (typeof ACCOUNT_METRICS)[number];
export type AccountMetrics = Partial<Record<AccountMetric, number>>;

export interface MetricDefinition {
  label: string;
  description: string;
  /** Unit used for display formatting. */
  unit: "count" | "seconds";
}

export const POST_METRIC_DEFINITIONS: Record<PostMetric, MetricDefinition> = {
  views: {
    label: "Views",
    description:
      "How many times the post was shown or played (impressions, views or plays, depending on the platform).",
    unit: "count",
  },
  reach: { label: "Reach", description: "Unique accounts that saw the post.", unit: "count" },
  likes: { label: "Likes", description: "Likes, favorites or reactions.", unit: "count" },
  comments: { label: "Comments", description: "Replies and comments.", unit: "count" },
  shares: { label: "Shares", description: "Reposts, retweets, shares and forwards.", unit: "count" },
  quotes: { label: "Quotes", description: "Posts quoting this post.", unit: "count" },
  saves: { label: "Saves", description: "Bookmarks and saves.", unit: "count" },
  clicks: { label: "Clicks", description: "Link, outbound and pin clicks.", unit: "count" },
  profileVisits: { label: "Profile visits", description: "Profile visits that came from the post.", unit: "count" },
  follows: { label: "Follows", description: "New followers that came from the post.", unit: "count" },
  watchTimeSeconds: { label: "Watch time", description: "Total time spent watching the video.", unit: "seconds" },
  averageWatchTimeSeconds: {
    label: "Average watch time",
    description: "Average time a viewer spent watching the video.",
    unit: "seconds",
  },
};

export const ACCOUNT_METRIC_DEFINITIONS: Record<AccountMetric, MetricDefinition> = {
  followers: { label: "Followers", description: "Followers, subscribers or channel members.", unit: "count" },
  following: { label: "Following", description: "Accounts this account follows.", unit: "count" },
  posts: { label: "Posts", description: "Total posts, videos or pins published by the account.", unit: "count" },
  totalViews: { label: "Total views", description: "Lifetime views across the account.", unit: "count" },
  totalLikes: { label: "Total likes", description: "Lifetime likes received across the account.", unit: "count" },
};

export type AnalyticsStatus =
  /** Metrics were read successfully. */
  | "ok"
  /** The post no longer exists or is not visible to the connected account. */
  | "not_found"
  /** The platform cannot report analytics for this post (unsupported platform, inbox draft, …). */
  | "unsupported"
  /** The connected account lacks the permission/scope needed to read analytics. */
  | "missing_permission"
  /** The platform asked us to slow down. */
  | "rate_limited"
  /** Credentials are invalid or expired. */
  | "credentials_error"
  /** Any other provider or network error. */
  | "error";

/** One published post to read analytics for. */
export interface AnalyticsTarget {
  /** Platform post id as returned by `post()` (`PostResult.id`). */
  postId: string;
  /** Publisher-specific publish data (`PostResult.extraData.platformData`), e.g. Bluesky uri/cid or TikTok publishId. */
  platformData?: Record<string, unknown>;
  /** Bluesky record URI (`at://…`). Equivalent to `platformData.uri`. */
  uri?: string;
  /** Media kind of the root post, when known. Some platforms report different metrics per kind. */
  mediaType?: "text" | "image" | "video" | "carousel";
  /** When the post was published (ISO 8601), when known. */
  publishedAt?: string;
}

export interface PostAnalytics {
  platform: Platform;
  /** The requested platform post id. */
  postId: string;
  status: AnalyticsStatus;
  /** Comparable metrics. Absent metrics are not reported by the platform for this post. */
  metrics: PostMetrics;
  /** Native metrics under the platform's own names, including ones without a comparable equivalent. */
  platformMetrics?: Record<string, number>;
  /** Public URL when the platform returned one. */
  url?: string;
  /** Platform-reported creation time (ISO 8601), when available. */
  publishedAt?: string;
  /** A replacement post id discovered while reading (e.g. TikTok publish id → public video id). */
  resolvedPostId?: string;
  /** Human-readable explanation when status is not "ok" or some metrics were unavailable. */
  message?: string;
  fetchedAt: string;
}

export interface AccountAnalytics {
  platform: Platform;
  status: AnalyticsStatus;
  metrics: AccountMetrics;
  platformMetrics?: Record<string, number>;
  message?: string;
  fetchedAt: string;
}

export interface RefreshedAnalyticsCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface PostAnalyticsResponse {
  platform: Platform;
  results: PostAnalytics[];
  refreshedCredentials?: RefreshedAnalyticsCredentials;
}

export interface AccountAnalyticsResponse extends AccountAnalytics {
  refreshedCredentials?: RefreshedAnalyticsCredentials;
}

export interface PlatformAnalyticsCapability {
  /** Whether SimplePost can read post analytics for this platform at all. */
  posts: boolean;
  /** Whether SimplePost can read account-level analytics (followers, …). */
  account: boolean;
  /** Comparable post metrics the platform can report (subject to post type and permissions). */
  postMetrics: readonly PostMetric[];
  accountMetrics: readonly AccountMetric[];
  /** Maximum number of posts read in one provider request (used for batching). */
  batchSize: number;
  /** Short caveats shown to users. */
  notes: readonly string[];
}

export const PLATFORM_ANALYTICS_CAPABILITIES: Record<Platform, PlatformAnalyticsCapability> = {
  x: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments", "shares", "quotes", "saves", "clicks", "profileVisits"],
    accountMetrics: ["followers", "following", "posts", "totalLikes"],
    batchSize: 100,
    notes: [
      "Link clicks and profile visits are only available for posts from the last 30 days.",
      "Each post read is billed to the X developer app, so X analytics refresh less often.",
    ],
  },
  bluesky: {
    posts: true,
    account: true,
    postMetrics: ["likes", "comments", "shares", "quotes", "saves"],
    accountMetrics: ["followers", "following", "posts"],
    batchSize: 25,
    notes: ["Bluesky does not report views or reach."],
  },
  threads: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments", "shares", "quotes"],
    accountMetrics: ["followers"],
    batchSize: 1,
    notes: ["Requires the threads_manage_insights permission."],
  },
  facebook: {
    posts: true,
    account: true,
    postMetrics: [
      "views",
      "reach",
      "likes",
      "comments",
      "shares",
      "clicks",
      "watchTimeSeconds",
      "averageWatchTimeSeconds",
    ],
    accountMetrics: ["followers"],
    batchSize: 1,
    notes: ["Requires the pages_read_engagement and read_insights permissions."],
  },
  instagram: {
    posts: true,
    account: true,
    postMetrics: [
      "views",
      "reach",
      "likes",
      "comments",
      "shares",
      "saves",
      "profileVisits",
      "follows",
      "watchTimeSeconds",
      "averageWatchTimeSeconds",
    ],
    accountMetrics: ["followers", "following", "posts"],
    batchSize: 1,
    notes: ["Requires a professional (Business or Creator) account and the insights permission."],
  },
  youtube: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments", "shares", "follows", "watchTimeSeconds", "averageWatchTimeSeconds"],
    accountMetrics: ["followers", "posts", "totalViews"],
    batchSize: 50,
    notes: ["Shares, watch time and subscribers gained come from the YouTube Analytics API and lag 2–3 days."],
  },
  tiktok: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments", "shares"],
    accountMetrics: ["followers", "following", "posts", "totalLikes"],
    batchSize: 20,
    notes: [
      "Requires the video.list scope (and user.info.stats for followers).",
      "Only public videos have statistics; inbox uploads have none until published in TikTok.",
    ],
  },
  linkedin: {
    posts: true,
    account: true,
    postMetrics: ["views", "reach", "likes", "comments", "shares"],
    accountMetrics: ["followers"],
    batchSize: 1,
    notes: ["LinkedIn only shares post analytics with apps approved for its Community Management API."],
  },
  pinterest: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments", "saves", "clicks"],
    accountMetrics: ["followers", "following", "posts"],
    batchSize: 1,
    notes: ["Pinterest reports the last 90 days and lifetime totals; analytics need a business account."],
  },
  forem: {
    posts: true,
    account: true,
    postMetrics: ["views", "likes", "comments"],
    accountMetrics: ["followers", "posts"],
    batchSize: 1000,
    notes: ["Page views update with a delay."],
  },
  telegram: {
    posts: false,
    account: true,
    postMetrics: [],
    accountMetrics: ["followers"],
    batchSize: 0,
    notes: ["Telegram bots cannot read message views or reactions; only the member count is available."],
  },
};

export function getAnalyticsCapability(platform: Platform): PlatformAnalyticsCapability {
  return PLATFORM_ANALYTICS_CAPABILITIES[platform];
}

export function supportsPostAnalytics(platform: string): boolean {
  return Boolean(PLATFORM_ANALYTICS_CAPABILITIES[platform as Platform]?.posts);
}

export function supportsAccountAnalytics(platform: string): boolean {
  return Boolean(PLATFORM_ANALYTICS_CAPABILITIES[platform as Platform]?.account);
}

/**
 * Sum of the interaction metrics the platform reported (likes, comments,
 * shares, quotes, saves). Clicks are deliberately excluded so engagement is
 * comparable across platforms that do and don't report them. Returns
 * undefined when none of the interaction metrics were reported.
 */
export function computeEngagements(metrics: PostMetrics): number | undefined {
  let total: number | undefined;
  for (const metric of ENGAGEMENT_METRICS) {
    const value = metrics[metric];
    if (typeof value === "number" && Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
}

/** Engagements divided by views (falling back to reach). Undefined without a denominator. */
export function computeEngagementRate(metrics: PostMetrics): number | undefined {
  const engagements = computeEngagements(metrics);
  const denominator = metrics.views ?? metrics.reach;
  if (engagements === undefined || !denominator) return undefined;
  return engagements / denominator;
}

/** Adds the additive metrics of `next` into `into`, keeping metrics absent when no post reported them. */
export function addPostMetrics(into: PostMetrics, next: PostMetrics): PostMetrics {
  for (const metric of ADDITIVE_POST_METRICS) {
    const value = next[metric];
    if (typeof value === "number" && Number.isFinite(value)) into[metric] = (into[metric] ?? 0) + value;
  }
  return into;
}

/** Keeps only finite, non-negative numbers for known metrics. */
export function normalizePostMetrics(metrics: Record<string, unknown>): PostMetrics {
  const normalized: PostMetrics = {};
  for (const metric of POST_METRICS) {
    const value = toMetricNumber(metrics[metric]);
    if (value !== undefined) normalized[metric] = value;
  }
  return normalized;
}

export function normalizeAccountMetrics(metrics: Record<string, unknown>): AccountMetrics {
  const normalized: AccountMetrics = {};
  for (const metric of ACCOUNT_METRICS) {
    const value = toMetricNumber(metrics[metric]);
    if (value !== undefined) normalized[metric] = value;
  }
  return normalized;
}

/** Parses provider numbers (which are sometimes strings, e.g. YouTube) into finite non-negative numbers. */
export function toMetricNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
