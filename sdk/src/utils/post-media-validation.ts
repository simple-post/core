import { mediaFormatFailure } from "./media-format-validation";
import { inspectLocalMedia, inspectRemoteMedia, MediaInspectionError } from "./media-inspection";

import { validateContentForPlatform } from "../validation";

import type { MediaInspection } from "./media-inspection";
import type { Media, Post } from "../types/post";
import type { ValidationIssue } from "../types/validation";

/** Async preflight for direct SDK/CLI callers, including local file inputs. */
export async function validatePostMedia(post: Post): Promise<ValidationIssue[]> {
  const failures: ValidationIssue[] = [];
  const cache = new Map<string, Promise<MediaInspection>>();
  const inspect = (media: Media): Promise<MediaInspection> => {
    // Public-URL providers still fetch the URL when a prepared path also
    // exists; do not let that path hide an inaccessible origin.
    const key = media.url ?? `file:${media.path}`;
    if (!cache.has(key)) cache.set(key, media.url ? inspectRemoteMedia(media.url) : inspectLocalMedia(media.path!));
    return cache.get(key)!;
  };
  for (const platform of post.platforms) {
    const media = [...(post.content.media ?? [])];
    const thumbnail = post.options?.youtube;
    if (platform === "youtube" && (thumbnail?.thumbnailUrl || thumbnail?.thumbnailPath)) {
      media.push({ type: "image", url: thumbnail.thumbnailUrl, path: thumbnail.thumbnailPath });
    } else if (platform === "youtube") {
      const video = media.find((item) => item.type === "video");
      if (video?.type === "video" && (video.thumbnailUrl || video.thumbnailPath)) {
        media.push({ type: "image", url: video.thumbnailUrl, path: video.thumbnailPath });
      }
    }
    for (const [index, item] of media.entries()) {
      const field = index >= (post.content.media?.length ?? 0) ? "thumbnail" : `media[${index}]`;
      try {
        const inspection = await inspect(item);
        item.size = inspection.size;
        const failure = mediaFormatFailure(inspection, platform, item.type);
        if (failure) failures.push({ ...failure, platform, severity: "error", field });
        if (field === "thumbnail" && inspection.size > 2 * 1024 * 1024) {
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
    if (post.content.media?.length)
      failures.push(
        ...validateContentForPlatform(platform, post.content, post.options).errors.filter((issue) =>
          issue.field?.startsWith("media"),
        ),
      );
  }
  return failures;
}
