import { postAnalyticsResult } from "../../utils/analytics";
import { flattenInsights, insightTotal, readMetaInsights } from "../../utils/meta-insights";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";
import type { AxiosInstance } from "axios";

const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"];

export async function fetchThreadsPostAnalytics(
  client: AxiosInstance,
  accessToken: string,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const results: PostAnalytics[] = [];
  for (const target of targets) {
    try {
      const insights = await readMetaInsights(client, `/${target.postId}/insights`, POST_METRICS, {
        access_token: accessToken,
      });
      const value = (name: string) => insightTotal(insights.get(name));
      const metrics: PostMetrics = {};
      const set = (metric: keyof PostMetrics, metricValue: number | undefined) => {
        if (metricValue !== undefined) metrics[metric] = metricValue;
      };
      set("views", value("views"));
      set("likes", value("likes"));
      set("comments", value("replies"));
      const reposts = value("reposts");
      const shares = value("shares");
      set("shares", reposts === undefined && shares === undefined ? undefined : (reposts ?? 0) + (shares ?? 0));
      set("quotes", value("quotes"));
      results.push(
        postAnalyticsResult("threads", target.postId, "ok", {
          metrics,
          platformMetrics: flattenInsights(insights),
        }),
      );
    } catch (error) {
      const code = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data?.error?.code;
      if (httpStatus(error) === 404 || (code === 100 && httpStatus(error) !== 403)) {
        results.push(
          postAnalyticsResult("threads", target.postId, "not_found", {
            message: "Threads could not find this post. It may have been deleted.",
          }),
        );
        continue;
      }
      throw error;
    }
  }
  return results;
}

export async function fetchThreadsAccountAnalytics(
  client: AxiosInstance,
  accessToken: string,
  userId: string,
): Promise<AccountAnalytics> {
  const insights = await readMetaInsights(client, `/${userId}/threads_insights`, ["followers_count"], {
    access_token: accessToken,
  });
  const followers = insightTotal(insights.get("followers_count"));
  return {
    platform: "threads",
    status: "ok",
    metrics: followers === undefined ? {} : { followers },
    platformMetrics: flattenInsights(insights),
    fetchedAt: new Date().toISOString(),
  };
}
