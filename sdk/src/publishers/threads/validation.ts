import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const THREADS_MAX_TEXT_LENGTH = 500;
export const THREADS_MAX_MEDIA_COUNT = 1;
export const THREADS_MAX_VIDEOS = 1;

export const THREADS_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: THREADS_MAX_TEXT_LENGTH },
  media: { maxCount: THREADS_MAX_MEDIA_COUNT, maxImages: 1, maxVideos: THREADS_MAX_VIDEOS, allowsMixed: false },
};

export function validateThreadsContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  let videos = 0;
  for (const item of media) {
    if (item.type === "video") videos += 1;
  }

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "threads",
      severity: "error",
      code: "content_required",
      message: "Threads posts require text or media.",
      field: "text",
    });
  }

  if (text.length > THREADS_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "threads",
      severity: "error",
      code: "text_too_long",
      message: `Threads text cannot exceed ${THREADS_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: THREADS_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "threads",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > THREADS_MAX_VIDEOS) {
    errors.push({
      platform: "threads",
      severity: "error",
      code: "too_many_videos",
      message: "Threads supports only one video per post.",
      field: "media",
      limit: THREADS_MAX_VIDEOS,
      actual: videos,
    });
  }

  if (mediaCount > THREADS_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "threads",
      severity: "warning",
      code: "too_many_media",
      message: "Threads supports only one media item per post. Only the first will be posted.",
      field: "media",
      limit: THREADS_MAX_MEDIA_COUNT,
      actual: mediaCount,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
