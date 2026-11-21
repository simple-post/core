import { AnalyticsError, numericFields, pickMetrics, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics } from "../../analytics";
import type { AxiosInstance } from "axios";

const VIDEO_FIELDS = ["id", "create_time", "share_url", "view_count", "like_count", "comment_count", "share_count"];
const USER_STATS_FIELDS = ["follower_count", "following_count", "likes_count", "video_count"];
const REQUEST_TIMEOUT_MS = 15_000;

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/** Publish ids (v_pub_…/p_pub_…) identify an upload, not a public video. */
export function isTikTokPublishId(id: string): boolean {
  return /^[a-z]_pub_/i.test(id) || !/^\d+$/.test(id);
}

/** Maps TikTok's error envelope (often sent with HTTP 200) onto analytics statuses. */
function throwForEnvelope(error: TikTokEnvelope<unknown>["error"]): void {
  const code = error?.code;
  if (!code || code === "ok") return;
  const detail = error?.message ? `: ${error.message}` : ".";
  if (code === "scope_not_authorized" || code === "scope_permission_missed") {
    throw new AnalyticsError(
      "missing_permission",
      `TikTok did not grant the analytics scope (video.list / user.info.stats)${detail} Reconnect the account after the scope is approved.`,
    );
  }
  if (code === "access_token_invalid" || code === "invalid_access_token") {
    throw new AnalyticsError("credentials_error", `TikTok rejected the saved credentials${detail}`);
  }
  if (code === "rate_limit_exceeded") throw new AnalyticsError("rate_limited", `TikTok rate limit reached${detail}`);
  throw new AnalyticsError("error", `TikTok analytics request failed (${code})${detail}`);
}

async function call<T>(request: () => Promise<{ data: TikTokEnvelope<T> }>): Promise<T | undefined> {
  try {
    const response = await request();
    throwForEnvelope(response.data?.error);
    return response.data?.data;
  } catch (error) {
    if (error instanceof AnalyticsError) throw error;
    const envelope = (error as { response?: { data?: TikTokEnvelope<unknown> } })?.response?.data;
    if (envelope?.error) throwForEnvelope(envelope.error);
    if (httpStatus(error) === 401)
      throw new AnalyticsError("credentials_error", "TikTok rejected the saved credentials.");
    throw error;
  }
}

/** Resolves a publish id to the public video id once TikTok has published it. */
async function resolvePublicId(client: AxiosInstance, publishId: string): Promise<{ id?: string; status?: string }> {
  const data = await call<{
    status?: string;
    publicaly_available_post_id?: Array<string | number>;
    publicly_available_post_id?: Array<string | number>;
  }>(() => client.post("/v2/post/publish/status/fetch/", { publish_id: publishId }, { timeout: REQUEST_TIMEOUT_MS }));
  const ids = data?.publicaly_available_post_id ?? data?.publicly_available_post_id;
  const id = ids?.[0];
  return { id: id === undefined || id === null ? undefined : String(id), status: data?.status };
}

export async function fetchTikTokPostAnalytics(
  client: AxiosInstance,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const videoIds = new Map<string, string>(); // target post id → public video id
  const unresolved = new Map<string, string>(); // target post id → reason

  for (const target of targets) {
    if (!isTikTokPublishId(target.postId)) {
      videoIds.set(target.postId, target.postId);
      continue;
    }
    const { id, status } = await resolvePublicId(client, target.postId);
    if (id) videoIds.set(target.postId, id);
    else
      unresolved.set(
        target.postId,
        status === "SEND_TO_USER_INBOX"
          ? "This video is waiting in the TikTok inbox. Statistics appear after it is published in the TikTok app."
          : "TikTok has not made this post public yet, so it has no statistics. Private posts never get statistics.",
      );
  }

  const videos = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(videoIds.values())];
  if (ids.length > 0) {
    const data = await call<{ videos?: Array<Record<string, unknown>> }>(() =>
      client.post(
        `/v2/video/query/?fields=${VIDEO_FIELDS.join(",")}`,
        { filters: { video_ids: ids } },
        { timeout: REQUEST_TIMEOUT_MS },
      ),
    );
    for (const video of data?.videos ?? []) if (video.id !== undefined) videos.set(String(video.id), video);
  }

  return targets.map((target) => {
    const reason = unresolved.get(target.postId);
    if (reason) return postAnalyticsResult("tiktok", target.postId, "unsupported", { message: reason });
    const videoId = videoIds.get(target.postId)!;
    const video = videos.get(videoId);
    const resolvedPostId = videoId === target.postId ? undefined : videoId;
    if (!video) {
      return postAnalyticsResult("tiktok", target.postId, "not_found", {
        resolvedPostId,
        message: "TikTok did not return this video. It may be private, deleted, or still under review.",
      });
    }
    const createTime = toFiniteNumber(video.create_time);
    return postAnalyticsResult("tiktok", target.postId, "ok", {
      metrics: pickMetrics(video, {
        view_count: "views",
        like_count: "likes",
        comment_count: "comments",
        share_count: "shares",
      }),
      platformMetrics: numericFields(video),
      url: typeof video.share_url === "string" ? video.share_url : undefined,
      publishedAt: createTime ? new Date(createTime * 1000).toISOString() : undefined,
      resolvedPostId,
    });
  });
}

export async function fetchTikTokAccountAnalytics(client: AxiosInstance): Promise<AccountAnalytics> {
  const data = await call<{ user?: Record<string, unknown> }>(() =>
    client.get(`/v2/user/info/?fields=${USER_STATS_FIELDS.join(",")}`, { timeout: REQUEST_TIMEOUT_MS }),
  );
  const user = data?.user ?? {};
  const value = (name: string) => toFiniteNumber(user[name]);
  return {
    platform: "tiktok",
    status: "ok",
    metrics: {
      ...(value("follower_count") === undefined ? {} : { followers: value("follower_count") }),
      ...(value("following_count") === undefined ? {} : { following: value("following_count") }),
      ...(value("video_count") === undefined ? {} : { posts: value("video_count") }),
      ...(value("likes_count") === undefined ? {} : { totalLikes: value("likes_count") }),
    },
    platformMetrics: numericFields(user),
    fetchedAt: new Date().toISOString(),
  };
}
