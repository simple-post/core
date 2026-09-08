import { mediaFormatFailure } from "./media-format-validation";
import { inspectLocalMedia, inspectRemoteMedia, MediaInspectionError } from "./media-inspection";

import { validateContentForPlatform } from "../validation";
import { validateInspectedMedia } from "../validation/media-rules";

import type { MediaInspection } from "./media-inspection";
import type { Media, Post } from "../types/post";
import type { ValidationIssue } from "../types/validation";

/** Async preflight for direct SDK/CLI callers, including local file inputs. */
export type MediaInspectionCache = Map<string, Promise<MediaInspection>>;

export async function validatePostMedia(
  post: Post,
  cache: MediaInspectionCache = new Map(),
): Promise<ValidationIssue[]> {
  const failures: ValidationIssue[] = [];
  const inspect = (media: Media, platform: string): Promise<MediaInspection> => {
    const prefersUrl =
      ["instagram", "threads", "forem"].includes(platform) || (platform === "pinterest" && media.type === "image");
    const url = media.url && (prefersUrl || !media.path) ? media.url : undefined;
    const direct = platform === "tiktok" && media.type === "image";
    const key = url ? `${direct ? "direct:" : ""}${url}` : `file:${media.path}`;
    if (!cache.has(key))
      cache.set(
        key,
        url ? inspectRemoteMedia(url, direct ? { maxRedirects: 0 } : undefined) : inspectLocalMedia(media.path!),
      );
    return cache.get(key)!;
  };
  for (const platform of post.platforms) {
    const media = [...(post.content.media ?? [])];
    const thumbnail = post.options?.youtube;
    if (platform === "youtube" && (thumbnail?.thumbnailUrl || thumbnail?.thumbnailPath)) {
      media.push({ type: "image", url: thumbnail.thumbnailUrl, path: thumbnail.thumbnailPath });
    } else if (platform === "youtube" || platform === "pinterest") {
      const video = media.find((item) => item.type === "video");
      if (video?.type === "video" && (video.thumbnailUrl || video.thumbnailPath)) {
        media.push({ type: "image", url: video.thumbnailUrl, path: video.thumbnailPath });
      }
    }
    for (const [index, item] of media.entries()) {
      const field = index >= (post.content.media?.length ?? 0) ? "thumbnail" : `media[${index}]`;
      try {
        const inspection = await inspect(item, platform);
        item.size = inspection.size;
        item.contentType = inspection.contentType;
        if (item.type === "video") item.durationSec = inspection.video?.durationSec;
        failures.push(
          ...validateInspectedMedia(platform, inspection, {
            mediaCount: post.content.media?.length ?? 0,
            thumbnail: field === "thumbnail",
          }).map((issue) => ({ ...issue, field })),
        );
        const failure = mediaFormatFailure(inspection, platform, item.type);
        if (failure) failures.push({ ...failure, platform, severity: "error", field });
        if (field === "thumbnail" && platform === "youtube" && inspection.size > 2 * 1024 * 1024) {
          failures.push({
            platform,
            severity: "error",
            code: "thumbnail_too_large",
            message: "YouTube custom thumbnails cannot exceed 2 MB.",
            field,
          });
        }
      } catch (error) {
        failures.push({
          platform,
          severity: "error",
          field,
          code: error instanceof MediaInspectionError ? error.code : "media_unavailable",
          message:
            error instanceof MediaInspectionError
              ? error.message
              : "SimplePost couldn't inspect this media. Upload the file directly or use a public URL.",
        });
      }
    }
    const validation = validateContentForPlatform(platform, post.content, post.options);
    failures.push(...validation.errors, ...validation.warnings);
  }
  return failures;
}
