import { countMedia, hasMediaSource } from "../validation-utils";

import type { Content, Video } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const YOUTUBE_MAX_TITLE_LENGTH = 100;
export const YOUTUBE_MAX_DESCRIPTION_LENGTH = 5000;

export const YOUTUBE_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: YOUTUBE_MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxVideos: 1, allowsMixed: false },
  video: {
    requiresVideo: true,
    maxTitleLength: YOUTUBE_MAX_TITLE_LENGTH,
    maxDescriptionLength: YOUTUBE_MAX_DESCRIPTION_LENGTH,
  },
};

export function getYouTubeVideoMetadata(content: Content, video: Video): { title: string; description?: string } {
  const fallbackTitle = content.text?.trim() || "Untitled Video";
  const title = video.title?.trim() || fallbackTitle;
  const description = video.description?.trim() || content.text?.trim() || undefined;
  return { title, description };
}

export function validateYouTubeContent(content: Content): ValidationResult {
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
    const metadata = getYouTubeVideoMetadata(content, video);
    if (video.title && video.title.length > YOUTUBE_MAX_TITLE_LENGTH) {
      errors.push({
        platform: "youtube",
        severity: "error",
        code: "title_too_long",
        message: `YouTube titles cannot exceed ${YOUTUBE_MAX_TITLE_LENGTH} characters.`,
        field: "title",
        limit: YOUTUBE_MAX_TITLE_LENGTH,
        actual: video.title.length,
      });
    } else if (!video.title && metadata.title.length > YOUTUBE_MAX_TITLE_LENGTH) {
      warnings.push({
        platform: "youtube",
        severity: "warning",
        code: "title_truncated",
        message: `YouTube titles cannot exceed ${YOUTUBE_MAX_TITLE_LENGTH} characters. The title will be truncated.`,
        field: "title",
        limit: YOUTUBE_MAX_TITLE_LENGTH,
        actual: metadata.title.length,
      });
    }

    if (metadata.description && metadata.description.length > YOUTUBE_MAX_DESCRIPTION_LENGTH) {
      errors.push({
        platform: "youtube",
        severity: "error",
        code: "description_too_long",
        message: `YouTube descriptions cannot exceed ${YOUTUBE_MAX_DESCRIPTION_LENGTH} characters.`,
        field: "description",
        limit: YOUTUBE_MAX_DESCRIPTION_LENGTH,
        actual: metadata.description.length,
      });
    }
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
