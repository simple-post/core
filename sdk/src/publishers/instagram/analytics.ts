import { numericFields, pickMetrics, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { flattenInsights, insightTotal, optionalInsights, readMetaInsights } from "../../utils/meta-insights";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";
import type { AxiosInstance } from "axios";

const COMMON_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"];
/** Feed (image/carousel) only. */
const FEED_METRICS = [...COMMON_METRICS, "profile_visits", "follows"];
/** Reels (every single video SimplePost publishes) only. */
const REELS_METRICS = [...COMMON_METRICS, "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];

export async function fetchInstagramPostAnalytics(
  client: AxiosInstance,
  authParams: Record<string, string>,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const results: PostAnalytics[] = [];
  for (const target of targets) {
    try {
      const fields = await client.get<Record<string, unknown>>(`/${target.postId}`, {
        params: { ...authParams, fields: "like_count,comments_count,timestamp,permalink,media_type" },
        timeout: 20_000,
      });
      const media = fields.data ?? {};
      const isVideo = target.mediaType === "video" || media.media_type === "VIDEO";
      const insights = await optionalInsights("Instagram", () =>
        readMetaInsights(client, `/${target.postId}/insights`, isVideo ? REELS_METRICS : FEED_METRICS, authParams),
      );
      const value = (name: string) => insightTotal(insights.values.get(name));

      const metrics: PostMetrics = pickMetrics(media, { like_count: "likes", comments_count: "comments" });
      const set = (metric: keyof PostMetrics, metricValue: number | undefined) => {
        if (metricValue !== undefined) metrics[metric] = metricValue;
      };
      set("views", value("views"));
      set("reach", value("reach"));
      set("likes", value("likes"));
      set("comments", value("comments"));
      set("shares", value("shares"));
      set("saves", value("saved"));
      set("profileVisits", value("profile_visits"));
      set("follows", value("follows"));
      const average = value("ig_reels_avg_watch_time");
      const total = value("ig_reels_video_view_total_time");
      set("averageWatchTimeSeconds", average === undefined ? undefined : average / 1000);
      set("watchTimeSeconds", total === undefined ? undefined : total / 1000);

      results.push(
        postAnalyticsResult("instagram", target.postId, "ok", {
          metrics,
          platformMetrics: { ...numericFields(media), ...flattenInsights(insights.values) },
          url: typeof media.permalink === "string" ? media.permalink : undefined,
          publishedAt: typeof media.timestamp === "string" ? media.timestamp : undefined,
          message: insights.note,
        }),
      );
    } catch (error) {
      const code = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data?.error?.code;
      if (httpStatus(error) === 404 || code === 100) {
        results.push(
          postAnalyticsResult("instagram", target.postId, "not_found", {
            message: "Instagram could not find this post. It may have been deleted or archived.",
          }),
        );
        continue;
      }
      throw error;
    }
  }
  return results;
}

export async function fetchInstagramAccountAnalytics(
  client: AxiosInstance,
  authParams: Record<string, string>,
  businessAccountId: string,
): Promise<AccountAnalytics> {
  const response = await client.get<Record<string, unknown>>(`/${businessAccountId}`, {
    params: { ...authParams, fields: "followers_count,follows_count,media_count" },
    timeout: 20_000,
  });
  const account = response.data ?? {};
  const value = (name: string) => toFiniteNumber(account[name]);
  return {
    platform: "instagram",
    status: "ok",
    metrics: {
      ...(value("followers_count") === undefined ? {} : { followers: value("followers_count") }),
      ...(value("follows_count") === undefined ? {} : { following: value("follows_count") }),
      ...(value("media_count") === undefined ? {} : { posts: value("media_count") }),
    },
    platformMetrics: numericFields(account),
    fetchedAt: new Date().toISOString(),
  };
}
