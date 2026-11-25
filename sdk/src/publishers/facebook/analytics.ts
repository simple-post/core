import { numericFields, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { flattenInsights, insightTotal, optionalInsights, readMetaInsights } from "../../utils/meta-insights";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";
import type { AxiosInstance } from "axios";

/** Feed post metrics (Graph API v25; impression metrics were replaced by media views in 2025). */
const POST_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"];
/** Video/Reel metrics. Facebook shares every uploaded video as a Reel since June 2025. */
const VIDEO_METRICS = [
  "fb_reels_total_plays",
  "blue_reels_play_count",
  "total_video_views",
  "post_video_avg_time_watched",
  "post_video_view_time",
  "post_video_social_actions",
  "post_video_likes_by_reaction_type",
];

interface SummaryEdge {
  summary?: { total_count?: unknown };
}

function summaryCount(edge: unknown): number | undefined {
  return toFiniteNumber((edge as SummaryEdge | undefined)?.summary?.total_count);
}

/** Feed posts are stored as `{pageId}_{postId}`; videos uploaded via /videos as bare video ids. */
export function isFacebookVideoId(postId: string): boolean {
  return !postId.includes("_");
}

async function readPost(client: AxiosInstance, token: string, target: AnalyticsTarget): Promise<PostAnalytics> {
  const fields = await client.get<Record<string, unknown>>(`/${target.postId}`, {
    params: {
      access_token: token,
      fields:
        "created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
    },
    timeout: 20_000,
  });
  const post = fields.data ?? {};
  const insights = await optionalInsights("Facebook", () =>
    readMetaInsights(client, `/${target.postId}/insights`, POST_METRICS, { access_token: token }),
  );

  const metrics: PostMetrics = {};
  const set = (metric: keyof PostMetrics, value: number | undefined) => {
    if (value !== undefined) metrics[metric] = value;
  };
  set("views", insightTotal(insights.values.get("post_media_view")));
  set("reach", insightTotal(insights.values.get("post_total_media_view_unique")));
  set("clicks", insightTotal(insights.values.get("post_clicks")));
  set("likes", summaryCount(post.reactions) ?? insightTotal(insights.values.get("post_reactions_by_type_total")));
  set("comments", summaryCount(post.comments));
  set("shares", toFiniteNumber((post.shares as { count?: unknown } | undefined)?.count) ?? 0);

  return postAnalyticsResult("facebook", target.postId, "ok", {
    metrics,
    platformMetrics: flattenInsights(insights.values),
    url: typeof post.permalink_url === "string" ? post.permalink_url : undefined,
    publishedAt: typeof post.created_time === "string" ? post.created_time : undefined,
    message: insights.note,
  });
}

async function readVideo(client: AxiosInstance, token: string, target: AnalyticsTarget): Promise<PostAnalytics> {
  const fields = await client.get<Record<string, unknown>>(`/${target.postId}`, {
    params: {
      access_token: token,
      fields: "created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)",
    },
    timeout: 20_000,
  });
  const video = fields.data ?? {};
  const insights = await optionalInsights("Facebook", () =>
    readMetaInsights(client, `/${target.postId}/video_insights`, VIDEO_METRICS, { access_token: token }),
  );
  const value = (name: string) => insightTotal(insights.values.get(name));
  const socialActions = insights.values.get("post_video_social_actions");
  const shares = typeof socialActions === "object" ? (socialActions.SHARE ?? socialActions.share) : undefined;

  const metrics: PostMetrics = {};
  const set = (metric: keyof PostMetrics, metricValue: number | undefined) => {
    if (metricValue !== undefined) metrics[metric] = metricValue;
  };
  set("views", value("fb_reels_total_plays") ?? value("blue_reels_play_count") ?? value("total_video_views"));
  set("likes", summaryCount(video.likes) ?? value("post_video_likes_by_reaction_type"));
  set("comments", summaryCount(video.comments));
  set("shares", shares);
  const average = value("post_video_avg_time_watched");
  const total = value("post_video_view_time");
  set("averageWatchTimeSeconds", average === undefined ? undefined : average / 1000);
  set("watchTimeSeconds", total === undefined ? undefined : total / 1000);

  const permalink = typeof video.permalink_url === "string" ? video.permalink_url : undefined;
  return postAnalyticsResult("facebook", target.postId, "ok", {
    metrics,
    platformMetrics: flattenInsights(insights.values),
    url: permalink?.startsWith("/") ? `https://www.facebook.com${permalink}` : permalink,
    publishedAt: typeof video.created_time === "string" ? video.created_time : undefined,
    message: insights.note,
  });
}

export async function fetchFacebookPostAnalytics(
  client: AxiosInstance,
  pageAccessToken: string,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const results: PostAnalytics[] = [];
  for (const target of targets) {
    try {
      results.push(
        isFacebookVideoId(target.postId)
          ? await readVideo(client, pageAccessToken, target)
          : await readPost(client, pageAccessToken, target),
      );
    } catch (error) {
      const code = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data?.error?.code;
      // Code 100 on the object itself means it no longer exists (or is not visible to the Page).
      if (httpStatus(error) === 404 || code === 100) {
        results.push(
          postAnalyticsResult("facebook", target.postId, "not_found", {
            message: "Facebook could not find this post. It may have been deleted.",
          }),
        );
        continue;
      }
      throw error;
    }
  }
  return results;
}

export async function fetchFacebookAccountAnalytics(
  client: AxiosInstance,
  pageId: string,
  pageAccessToken: string,
): Promise<AccountAnalytics> {
  const response = await client.get<Record<string, unknown>>(`/${pageId}`, {
    params: { access_token: pageAccessToken, fields: "followers_count,fan_count" },
    timeout: 20_000,
  });
  const page = response.data ?? {};
  const followers = toFiniteNumber(page.followers_count) ?? toFiniteNumber(page.fan_count);
  return {
    platform: "facebook",
    status: "ok",
    metrics: followers === undefined ? {} : { followers },
    platformMetrics: numericFields(page),
    fetchedAt: new Date().toISOString(),
  };
}
