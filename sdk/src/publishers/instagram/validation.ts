import { hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const INSTAGRAM_MAX_CAPTION_LENGTH = 2200;
export const INSTAGRAM_MAX_MEDIA_COUNT = 10;
export const INSTAGRAM_MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
export const INSTAGRAM_MAX_VIDEO_SIZE_BYTES = 300 * 1024 * 1024;

export const INSTAGRAM_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: INSTAGRAM_MAX_CAPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxCount: INSTAGRAM_MAX_MEDIA_COUNT, allowsMixed: true },
  image: { maxSizeBytes: INSTAGRAM_MAX_IMAGE_SIZE_BYTES },
  video: { maxSizeBytes: INSTAGRAM_MAX_VIDEO_SIZE_BYTES },
};

export function validateInstagramContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  if (mediaCount === 0) {
    errors.push({
      platform: "instagram",
      severity: "error",
      code: "media_required",
      message: "Instagram posts require at least one media item.",
      field: "media",
    });
  }

  if (text.length > INSTAGRAM_MAX_CAPTION_LENGTH) {
    errors.push({
      platform: "instagram",
      severity: "error",
      code: "caption_too_long",
      message: `Instagram captions cannot exceed ${INSTAGRAM_MAX_CAPTION_LENGTH} characters.`,
      field: "text",
      limit: INSTAGRAM_MAX_CAPTION_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "instagram",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (mediaCount > INSTAGRAM_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "instagram",
      severity: "warning",
      code: "too_many_media",
      message: `Instagram supports up to ${INSTAGRAM_MAX_MEDIA_COUNT} media items. Only the first ${INSTAGRAM_MAX_MEDIA_COUNT} will be posted.`,
      field: "media",
      limit: INSTAGRAM_MAX_MEDIA_COUNT,
      actual: mediaCount,
    });
  }

  errors.push(
    ...validateMediaSizes("instagram", "Instagram", media, {
      image: INSTAGRAM_MAX_IMAGE_SIZE_BYTES,
      video: INSTAGRAM_MAX_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
