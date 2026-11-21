import { google, type Auth, type youtube_v3 } from "googleapis";

import { numericFields, pickMetrics, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";
import type { Logger } from "../../utils/logger";

const REQUEST_TIMEOUT_MS = 15_000;
/** YouTube Analytics accepts long ranges; this predates every SimplePost upload. */
const ANALYTICS_START_DATE = "2005-04-23";
/** Skip the optional Analytics API for a while after it reported being unavailable for the project/token. */
const ANALYTICS_DISABLED_MS = 60 * 60_000;
const analyticsDisabledUntil = new Map<string, number>();

/**
 * YouTube Data API statistics are real time; the YouTube Analytics API adds
 * watch time, shares and subscribers gained (with a 2–3 day delay). The
 * Analytics API is optional: when it is not enabled for the Google Cloud
 * project, Data API statistics are still returned.
 */
export async function fetchYouTubePostAnalytics(
  youtube: youtube_v3.Youtube,
  authClient: Auth.OAuth2Client,
  targets: AnalyticsTarget[],
  logger: Logger,
  clientKey: string,
): Promise<PostAnalytics[]> {
  const ids = targets.map((target) => target.postId);
  const response = await youtube.videos.list(
    { part: ["statistics", "snippet", "contentDetails"], id: ids, maxResults: ids.length },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  const videos = new Map((response.data.items ?? []).map((item) => [item.id ?? "", item]));
  const deeper = await fetchAnalyticsReport(authClient, ids, logger, clientKey);

  return targets.map((target) => {
    const video = videos.get(target.postId);
    if (!video) {
      return postAnalyticsResult("youtube", target.postId, "not_found", {
        message:
          "YouTube did not return this video. It may be deleted, private to another channel, or still processing.",
      });
    }
    const statistics = (video.statistics ?? {}) as Record<string, unknown>;
    const metrics: PostMetrics = {
      ...pickMetrics(deeper.get(target.postId), {
        shares: "shares",
        estimatedMinutesWatched: "watchTimeSeconds",
        averageViewDuration: "averageWatchTimeSeconds",
        subscribersGained: "follows",
      }),
      ...pickMetrics(statistics, { viewCount: "views", likeCount: "likes", commentCount: "comments" }),
    };
    if (metrics.watchTimeSeconds !== undefined) metrics.watchTimeSeconds *= 60;

    return postAnalyticsResult("youtube", target.postId, "ok", {
      metrics,
      platformMetrics: { ...numericFields(statistics), ...numericFields(deeper.get(target.postId), "analytics.") },
      url: `https://www.youtube.com/watch?v=${target.postId}`,
      publishedAt: video.snippet?.publishedAt ?? undefined,
    });
  });
}

async function fetchAnalyticsReport(
  authClient: Auth.OAuth2Client,
  ids: string[],
  logger: Logger,
  clientKey: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = new Map<string, Record<string, unknown>>();
  if ((analyticsDisabledUntil.get(clientKey) ?? 0) > Date.now()) return rows;

  try {
    const analytics = google.youtubeAnalytics({ version: "v2", auth: authClient });
    const metrics = [
      "views",
      "likes",
      "comments",
      "shares",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "subscribersGained",
    ];
    const response = await analytics.reports.query(
      {
        ids: "channel==MINE",
        startDate: ANALYTICS_START_DATE,
        endDate: new Date().toISOString().slice(0, 10),
        dimensions: "video",
        filters: `video==${ids.join(",")}`,
        metrics: metrics.join(","),
        maxResults: ids.length,
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const headers = (response.data.columnHeaders ?? []).map((header) => header.name ?? "");
    for (const row of response.data.rows ?? []) {
      const record = Object.fromEntries(headers.map((name, index) => [name, row[index]]));
      if (typeof record.video === "string") rows.set(record.video, record);
    }
  } catch (error) {
    const status = httpStatus(error);
    // 403: API not enabled for the project or scope not granted; 400: unsupported filter for this channel.
    if (status === 403 || status === 401 || status === 400) {
      analyticsDisabledUntil.set(clientKey, Date.now() + ANALYTICS_DISABLED_MS);
    }
    logger.info(`YouTube Analytics API unavailable (${status ?? "network error"}); using Data API statistics only.`);
  }
  return rows;
}

export async function fetchYouTubeAccountAnalytics(youtube: youtube_v3.Youtube): Promise<AccountAnalytics> {
  const response = await youtube.channels.list({ part: ["statistics"], mine: true }, { timeout: REQUEST_TIMEOUT_MS });
  const statistics = (response.data.items?.[0]?.statistics ?? undefined) as Record<string, unknown> | undefined;
  if (!statistics) {
    return {
      platform: "youtube",
      status: "not_found",
      metrics: {},
      message: "This connection does not have a YouTube channel.",
      fetchedAt: new Date().toISOString(),
    };
  }
  const followers = statistics.hiddenSubscriberCount === true ? undefined : toFiniteNumber(statistics.subscriberCount);
  return {
    platform: "youtube",
    status: "ok",
    metrics: {
      ...(followers === undefined ? {} : { followers }),
      ...(toFiniteNumber(statistics.videoCount) === undefined ? {} : { posts: toFiniteNumber(statistics.videoCount) }),
      ...(toFiniteNumber(statistics.viewCount) === undefined
        ? {}
        : { totalViews: toFiniteNumber(statistics.viewCount) }),
    },
    platformMetrics: numericFields(statistics),
    fetchedAt: new Date().toISOString(),
  };
}
