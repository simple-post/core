import axios from "axios";

import { numericFields, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";

const X_API = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 20_000;
/** X only returns private metrics (link clicks, profile visits) for the author's posts from the last 30 days. */
const PRIVATE_METRICS_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Snowflake epoch used by X post ids. */
const X_EPOCH_MS = 1_288_834_974_657;

interface XPostLookup {
  data?: Array<Record<string, unknown> & { id?: string; created_at?: string }>;
  errors?: Array<{ value?: string; resource_id?: string; title?: string; detail?: string; type?: string }>;
}

/** Creation time encoded in an X post id, or undefined for ids that are not snowflakes. */
export function xPostCreatedAt(postId: string): Date | undefined {
  if (!/^\d{10,20}$/.test(postId)) return undefined;
  try {
    const ms = Number(BigInt(postId) >> BigInt(22)) + X_EPOCH_MS;
    return Number.isFinite(ms) ? new Date(ms) : undefined;
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** X has renamed some fields ("repost_count" vs "retweet_count"); accept both spellings. */
function first(source: Record<string, unknown> | undefined, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = toFiniteNumber(source?.[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function mapXPost(post: Record<string, unknown>): {
  metrics: PostMetrics;
  platformMetrics: Record<string, number>;
} {
  const publicMetrics = object(post.public_metrics);
  const privateMetrics = object(post.non_public_metrics);
  const organicMetrics = object(post.organic_metrics);

  const metrics: PostMetrics = {};
  const set = (metric: keyof PostMetrics, value: number | undefined) => {
    if (value !== undefined) metrics[metric] = value;
  };
  set("views", first(publicMetrics, "impression_count") ?? first(privateMetrics, "impression_count"));
  set("likes", first(publicMetrics, "like_count"));
  set("comments", first(publicMetrics, "reply_count"));
  set("shares", first(publicMetrics, "retweet_count", "repost_count"));
  set("quotes", first(publicMetrics, "quote_count"));
  set("saves", first(publicMetrics, "bookmark_count"));
  set("clicks", first(privateMetrics, "url_link_clicks") ?? first(organicMetrics, "url_link_clicks"));
  set("profileVisits", first(privateMetrics, "user_profile_clicks") ?? first(organicMetrics, "user_profile_clicks"));

  return {
    metrics,
    platformMetrics: {
      ...numericFields(publicMetrics),
      ...numericFields(privateMetrics, "non_public."),
      ...numericFields(organicMetrics, "organic."),
    },
  };
}

async function lookup(accessToken: string, ids: string[], includePrivate: boolean): Promise<XPostLookup> {
  const fields = ["public_metrics", "created_at", ...(includePrivate ? ["non_public_metrics", "organic_metrics"] : [])];
  const response = await axios.get<XPostLookup>(`${X_API}/tweets`, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { ids: ids.join(","), "tweet.fields": fields.join(",") },
  });
  return response.data ?? {};
}

/**
 * Reads metrics with GET /2/tweets (up to 100 ids). Posts younger than 30
 * days are read with private metrics in a separate request, because X fails
 * those fields for older posts.
 */
export async function fetchXPostAnalytics(
  accessToken: string,
  targets: AnalyticsTarget[],
  username: string | undefined,
  now: Date = new Date(),
): Promise<PostAnalytics[]> {
  const recent: string[] = [];
  const older: string[] = [];
  for (const target of targets) {
    const createdAt = xPostCreatedAt(target.postId);
    (createdAt && now.getTime() - createdAt.getTime() < PRIVATE_METRICS_WINDOW_MS ? recent : older).push(target.postId);
  }

  const posts = new Map<string, Record<string, unknown>>();
  const missing = new Map<string, string>();
  const collect = (response: XPostLookup) => {
    for (const post of response.data ?? []) if (post.id) posts.set(post.id, post);
    for (const error of response.errors ?? []) {
      const id = error.resource_id ?? error.value;
      if (id) missing.set(id, error.detail ?? error.title ?? "X could not return this post.");
    }
  };

  if (recent.length > 0) {
    const response = await lookup(accessToken, recent, true);
    collect(response);
    // A post can fail private metrics (e.g. it is a reply in someone else's conversation); retry those publicly.
    const retry = recent.filter((id) => !posts.has(id) && missing.has(id));
    if (retry.length > 0) {
      for (const id of retry) missing.delete(id);
      collect(await lookup(accessToken, retry, false));
    }
  }
  if (older.length > 0) collect(await lookup(accessToken, older, false));

  return targets.map((target) => {
    const post = posts.get(target.postId);
    if (!post) {
      return postAnalyticsResult("x", target.postId, "not_found", {
        message: missing.get(target.postId) ?? "X did not return this post. It may have been deleted.",
      });
    }
    const { metrics, platformMetrics } = mapXPost(post);
    return postAnalyticsResult("x", target.postId, "ok", {
      metrics,
      platformMetrics,
      publishedAt: typeof post.created_at === "string" ? post.created_at : undefined,
      url: `https://x.com/${username || "i/web"}/status/${target.postId}`,
    });
  });
}

export async function fetchXAccountAnalytics(accessToken: string): Promise<AccountAnalytics> {
  const response = await axios.get<{ data?: { public_metrics?: Record<string, unknown> } }>(`${X_API}/users/me`, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { "user.fields": "public_metrics" },
  });
  const metrics = response.data?.data?.public_metrics;
  const followers = first(metrics, "followers_count");
  const following = first(metrics, "following_count");
  const posts = first(metrics, "tweet_count", "post_count");
  const totalLikes = first(metrics, "like_count");
  return {
    platform: "x",
    status: "ok",
    metrics: {
      ...(followers === undefined ? {} : { followers }),
      ...(following === undefined ? {} : { following }),
      ...(posts === undefined ? {} : { posts }),
      ...(totalLikes === undefined ? {} : { totalLikes }),
    },
    platformMetrics: numericFields(metrics),
    fetchedAt: new Date().toISOString(),
  };
}
