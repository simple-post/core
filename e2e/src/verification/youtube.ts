import { expect } from "@playwright/test";
import { secret, type Account, type LiveConfig } from "../config.js";
import { SchedulerApi } from "../http.js";
import type { Materialized, PostingResult } from "../types.js";
import { verifyFixtureImage } from "./image.js";
import { mediaFiles } from "../media.js";

type YouTubeVideo = {
  id: string;
  snippet: {
    channelId: string;
    title: string;
    description: string;
    tags?: string[];
    categoryId: string;
    thumbnails?: Record<string, { url: string }>;
  };
  status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
  contentDetails?: { duration?: string };
  fileDetails?: {
    fileSize?: string;
    durationMs?: string;
    videoStreams?: { widthPixels?: number; heightPixels?: number }[];
  };
  processingDetails?: { processingStatus?: string };
};

export type YouTubeVerification = {
  verifiedFields: string[];
  privateMediaProof?: {
    source: "scheduler-owner-google-api" | "direct-owner-google-api";
    videoId: string;
    channelId: string;
    title: string;
    description: string;
    privacyStatus: "private";
    fileSize: number;
    durationMs: number;
    contentDuration: string;
    widthPixels: number;
    heightPixels: number;
    processingStatus: "succeeded";
  };
};

// These are the original generated fixture properties, not transcoded player
// dimensions. Owner-only fileDetails must describe the uploaded source file.
async function verifyPrivateMedia(video: YouTubeVideo, s: Materialized, account: Account, config?: LiveConfig) {
  if (!config) throw new Error("Private YouTube verification requires local fixture configuration");
  expect(account.resources.channelId, "Private video needs the discovered owner channel ID").toMatch(/^UC[\w-]+$/);
  expect(s.expectedTitle, "Private video needs an exact expected title").toBeTruthy();
  expect(s.media, "YouTube must contain exactly one source video").toHaveLength(1);
  expect(["video", "silentVideo"]).toContain(s.media[0]);
  expect(s.expectedFields.privacyStatus, "Private proof cannot substitute for public/unlisted visibility").toBe(
    "private",
  );
  expect(video.status.privacyStatus).toBe("private");
  const [fixture] = await mediaFiles(config, s.media);
  expect(video.processingDetails?.processingStatus, "YouTube source processing must have succeeded").toBe("succeeded");
  const file = video.fileDetails;
  expect(file, "Owner-only source file details are required").toBeDefined();
  expect(file?.fileSize, "Original uploaded byte count must be present").toMatch(/^[1-9]\d*$/);
  expect(Number(file!.fileSize), "Original uploaded byte count must match fixture").toBe(fixture.size);
  expect(file?.durationMs, "Original source duration must be present").toMatch(/^[1-9]\d*$/);
  const durationMs = Number(file!.durationMs);
  expect(
    Math.abs(durationMs - fixture.durationSec! * 1000),
    "Original source duration must match fixture within 100ms",
  ).toBeLessThanOrEqual(100);
  expect(file?.videoStreams, "Exactly one original video stream is required").toHaveLength(1);
  const stream = file!.videoStreams![0];
  expect(stream.widthPixels, "Original video width").toBe(720);
  expect(stream.heightPixels, "Original video height").toBe(1280);
  const duration = video.contentDetails?.duration;
  expect(duration, "Processed content duration is required").toMatch(/^PT(?:(\d+)H)?(?:(\d+)M)?(\d+(?:\.\d+)?)S$/);
  const match = duration!.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(\d+(?:\.\d+)?)S$/)!;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3]);
  // Production returns PT5S for our exact 4000ms source. Keep the owner-only
  // source duration strict above; allow at most one second of processed padding.
  expect(seconds, "Processed duration cannot truncate the source").toBeGreaterThanOrEqual(fixture.durationSec! - 0.1);
  expect(seconds, "Processed duration must stay within one second of the source").toBeLessThanOrEqual(
    fixture.durationSec! + 1,
  );
  return {
    source: account.observer.youtubeAccessTokenEnv
      ? ("direct-owner-google-api" as const)
      : ("scheduler-owner-google-api" as const),
    videoId: video.id,
    channelId: video.snippet.channelId,
    title: video.snippet.title,
    description: video.snippet.description,
    privacyStatus: "private" as const,
    fileSize: Number(file!.fileSize),
    durationMs,
    contentDuration: duration!,
    widthPixels: stream.widthPixels!,
    heightPixels: stream.heightPixels!,
    processingStatus: "succeeded" as const,
  };
}

type YouTubeReadback = {
  video: YouTubeVideo;
  playlistItems?:
    | { videoId?: string; contentDetails?: { videoId?: string } }[]
    | { items?: { videoId?: string; contentDetails?: { videoId?: string } }[] };
};
// Independent readback, using the owner's normal OAuth access token. Scheduler secrets are
// never extracted. The browser visit is still required after these metadata assertions.
export async function verifyYouTubeMetadata(
  s: Materialized,
  account: Account,
  result: PostingResult,
  config?: LiveConfig,
): Promise<YouTubeVerification> {
  expect(result.postId, "Exact YouTube receipt ID is required").toMatch(/^[\w-]{11}$/);
  async function getGoogle(route: string, params: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${route}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${secret(account.observer.youtubeAccessTokenEnv!)}` },
    });
    if (!response.ok)
      throw new Error(`YouTube metadata read failed (${response.status}); check owner OAuth scopes/token.`);
    return response.json();
  }
  let video: YouTubeVideo;
  let playlistItems: { videoId?: string; contentDetails?: { videoId?: string } }[] = [];
  if (account.observer.youtubeAccessTokenEnv) {
    const data = await getGoogle("videos", {
      part: "snippet,status,contentDetails,fileDetails,processingDetails",
      id: result.postId!,
    });
    expect(data.items, "Exact uploaded video must be readable by its owner").toHaveLength(1);
    video = data.items[0] as YouTubeVideo;
    const channels = await getGoogle("channels", { part: "id", mine: "true" });
    expect(
      channels.items?.some((channel: { id: string }) => channel.id === video.snippet.channelId),
      "Google token must own the exact video channel",
    ).toBe(true);
  } else {
    if (!config || !account.observer.youtubeReadback) throw new Error("YouTube owner readback is not configured.");
    const playlistId = s.expectedFields.playlistId;
    const query = playlistId === undefined ? "" : `?playlistId=${encodeURIComponent(String(playlistId))}`;
    const data = await new SchedulerApi(config).request<YouTubeReadback>(
      `/api/v1/accounts/${encodeURIComponent(account.id)}/youtube/videos/${encodeURIComponent(result.postId!)}${query}`,
    );
    video = data.video;
    playlistItems = Array.isArray(data.playlistItems) ? data.playlistItems : (data.playlistItems?.items ?? []);
  }
  expect(video.id).toBe(result.postId);
  expect(video.snippet.channelId).toBe(account.resources.channelId ?? account.platformAccountId);
  expect(video.snippet.description).toBe(s.expectedText);
  if (s.expectedTitle) expect(video.snippet.title).toBe(s.expectedTitle);
  const read: Record<string, unknown> = {
    privacyStatus: video.status.privacyStatus,
    selfDeclaredMadeForKids: video.status.selfDeclaredMadeForKids,
    tags: video.snippet.tags ?? [],
    categoryId: video.snippet.categoryId,
  };
  const verified: string[] = [];
  for (const [key, value] of Object.entries(s.expectedFields)) {
    if (key === "thumbnailImage") {
      const thumbnails = video.snippet.thumbnails;
      if (!thumbnails) throw new Error("YouTube thumbnail metadata missing");
      const thumbnail = thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high;
      if (!thumbnail) throw new Error("YouTube thumbnail metadata missing");
      const imageUrl = new URL(thumbnail.url);
      if (imageUrl.protocol !== "https:" || !["i.ytimg.com", "i9.ytimg.com"].includes(imageUrl.hostname))
        throw new Error("Unexpected YouTube thumbnail URL");
      const response = await fetch(imageUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`YouTube thumbnail unavailable (${response.status})`);
      await verifyFixtureImage(Buffer.from(await response.arrayBuffer()), String(value), "Published YouTube thumbnail");
      verified.push(key);
    } else if (key === "playlistId") {
      const playlist = account.observer.youtubeAccessTokenEnv
        ? await getGoogle("playlistItems", {
            part: "contentDetails",
            playlistId: String(value),
            videoId: result.postId!,
          })
        : { items: playlistItems };
      expect(
        playlist.items.some(
          (item: { videoId?: string; contentDetails?: { videoId?: string } }) =>
            (item.contentDetails?.videoId ?? item.videoId) === result.postId,
        ),
      ).toBe(true);
      verified.push(key);
    } else if (key in read) {
      if (key === "tags")
        expect([...(read.tags as string[])].sort(), "YouTube tags must match exact membership and cardinality").toEqual(
          [...(value as string[])].sort(),
        );
      else expect(read[key], `YouTube ${key}`).toEqual(value);
      verified.push(key);
    }
  }
  const privateMediaProof =
    s.expectedFields.privacyStatus === "private" ? await verifyPrivateMedia(video, s, account, config) : undefined;
  return { verifiedFields: verified, ...(privateMediaProof ? { privateMediaProof } : {}) };
}
