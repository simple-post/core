import {
  bearer,
  hasId,
  invalidRequest,
  invalidResponse,
  number,
  record,
  requestJson,
  resultMetrics,
  string,
} from "./shared";

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialActivityResult,
  SocialPostMetrics,
} from "../types/social";

const VIDEO_ID = /^\d{15,24}$/u;

export class TikTokProvider implements SocialActivityProvider {
  readonly platform = "TikTok";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["metrics"]);
  }

  async getPostMetrics(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
  ): Promise<SocialActivityResult<SocialPostMetrics>> {
    const platformData = record(post.platformData);
    const mediaType = string(platformData.mediaType)?.toLowerCase();
    const publishMode = string(platformData.publishMode)?.toLowerCase();
    // TikTok Display API video/query cannot resolve photo posts, inbox drafts,
    // or Direct Post task IDs. Only a completed public numeric video ID is a
    // valid analytics target.
    if (mediaType === "photo" || publishMode === "draft" || string(platformData.publishId) === post.nativePostId)
      return invalidRequest(this.platform, "this TikTok target is not a published video.");
    if (!hasId(post.nativePostId, VIDEO_ID))
      return invalidRequest(this.platform, "the target is not a public TikTok video ID.");

    const url = new URL("https://open.tiktokapis.com/v2/video/query/");
    url.searchParams.set("fields", "id,like_count,comment_count,share_count,view_count");
    const response = await requestJson(
      this.platform,
      url,
      {
        method: "POST",
        headers: { ...bearer(account.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: [post.nativePostId] } }),
      },
      { isWrite: false },
    );
    if (!response.result.ok) return response.result;
    const videos = record(response.result.data.data).videos;
    if (!Array.isArray(videos)) return invalidResponse(this.platform);
    const video = videos.map((value) => record(value)).find((value) => string(value.id) === post.nativePostId);
    if (!video)
      return invalidRequest(this.platform, "this published video is not exposed by the connected Display API account.");
    const values: Record<string, number> = {};
    for (const key of ["like_count", "comment_count", "share_count", "view_count"]) {
      const value = number(video[key]);
      if (value !== undefined) values[key] = value;
    }
    if (Object.keys(values).length === 0) return invalidResponse(this.platform);
    return resultMetrics(post.nativePostId, values);
  }
}
