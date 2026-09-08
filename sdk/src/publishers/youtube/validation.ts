import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content, Video, YouTubeOptions } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const YOUTUBE_MAX_TITLE_LENGTH = 100;
export const YOUTUBE_MAX_DESCRIPTION_LENGTH = 5000;
export const YOUTUBE_MAX_VIDEO_SIZE_BYTES = 256 * 1024 * 1024 * 1024;
export const YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES = 2 * 1024 * 1024;

export const YOUTUBE_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: YOUTUBE_MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxVideos: 1, allowsMixed: false },
  video: {
    requiresVideo: true,
    maxSizeBytes: YOUTUBE_MAX_VIDEO_SIZE_BYTES,
    maxTitleLength: YOUTUBE_MAX_TITLE_LENGTH,
    maxDescriptionLength: YOUTUBE_MAX_DESCRIPTION_LENGTH,
  },
  notes: [`Custom thumbnails cannot exceed ${YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES / (1024 * 1024)} MB.`],
};

export function getYouTubeVideoMetadata(
  content: Content,
  video: Video,
  options?: Pick<YouTubeOptions, "title" | "description">,
): { title: string; description?: string } {
  const fallbackTitle = content.text?.trim() || "Untitled Video";
  const title = options?.title?.trim() || video.title?.trim() || fallbackTitle;
  const description = options?.description?.trim() || video.description?.trim() || content.text?.trim() || undefined;
  return { title, description };
}

export function validateYouTubeContent(content: Content, options?: YouTubeOptions): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const media = content.media ?? [];
  const { images, videos } = countMedia(media);

  if (media.length === 0 || videos === 0) {
    errors.push({
      platform: "youtube",
      severity: "error",
      code: "video_required",
      message: "YouTube posts require a video.",
      field: "video",
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "youtube",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 1) {
    warnings.push({
      platform: "youtube",
      severity: "warning",
      code: "too_many_videos",
      message: "YouTube supports only one video per post. Only the first video will be uploaded.",
      field: "media",
      limit: 1,
      actual: videos,
    });
  }

  if (images > 0) {
    warnings.push({
      platform: "youtube",
      severity: "warning",
      code: "images_ignored",
      message: "YouTube posts ignore images. Only the first video will be uploaded.",
      field: "media",
    });
  }

  const video = media.find((item) => item.type === "video") as Video | undefined;

  if (video) {
    const metadata = getYouTubeVideoMetadata(content, video, options);
    for (const [field, value, limit] of [
      ["title", metadata.title, YOUTUBE_MAX_TITLE_LENGTH],
      ["description", metadata.description ?? "", YOUTUBE_MAX_DESCRIPTION_LENGTH],
    ] as const) {
      const actual = field === "description" ? new TextEncoder().encode(value).length : [...value].length;
      if (actual > limit)
        errors.push({
          platform: "youtube",
          severity: "error",
          code: `${field}_too_long`,
          message: `YouTube ${field} is ${actual} ${field === "description" ? "UTF-8 bytes" : "characters"}; the limit is ${limit}. Shorten the final ${field}.`,
          field,
          limit,
          actual,
        });
      if (/[<>]/.test(value))
        errors.push({
          platform: "youtube",
          severity: "error",
          code: `${field}_invalid_characters`,
          message: `YouTube ${field} cannot contain < or >. Remove these characters.`,
          field,
        });
    }
  }

  errors.push(...validateMediaSizes("youtube", "YouTube", media, { video: YOUTUBE_MAX_VIDEO_SIZE_BYTES }));

  return { errors, warnings, isValid: errors.length === 0 };
}
