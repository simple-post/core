import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const TIKTOK_MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024;
export const TIKTOK_MAX_PHOTO_SIZE = 50 * 1024 * 1024;
export const TIKTOK_MAX_VIDEO_CAPTION_LENGTH = 2200;
export const TIKTOK_MAX_PHOTO_CAPTION_LENGTH = 90;
export const TIKTOK_MAX_MEDIA_COUNT = 1;

export const TIKTOK_VALIDATION_RULES: PlatformValidationRules = {
  text: {
    maxCaptionLengthByMediaType: { video: TIKTOK_MAX_VIDEO_CAPTION_LENGTH, image: TIKTOK_MAX_PHOTO_CAPTION_LENGTH },
  },
  media: { requiresMedia: true, minCount: 1, maxCount: TIKTOK_MAX_MEDIA_COUNT },
  video: { maxSizeBytes: TIKTOK_MAX_VIDEO_SIZE },
  image: { maxSizeBytes: TIKTOK_MAX_PHOTO_SIZE },
};

export function validateTikTokContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  if (mediaCount === 0) {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "media_required",
      message: "TikTok posts require at least one media item.",
      field: "media",
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "tiktok",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (mediaCount > TIKTOK_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "tiktok",
      severity: "warning",
      code: "too_many_media",
      message: "TikTok posts support only one media item in this SDK. Only the first media will be posted.",
      field: "media",
      limit: TIKTOK_MAX_MEDIA_COUNT,
      actual: mediaCount,
    });
  }

  const primaryMedia = media[0];
  if (primaryMedia?.type === "video" && text.length > TIKTOK_MAX_VIDEO_CAPTION_LENGTH) {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "caption_too_long",
      message: `TikTok video captions cannot exceed ${TIKTOK_MAX_VIDEO_CAPTION_LENGTH} characters.`,
      field: "text",
      limit: TIKTOK_MAX_VIDEO_CAPTION_LENGTH,
      actual: text.length,
    });
  }

  if (primaryMedia?.type === "image" && text.length > TIKTOK_MAX_PHOTO_CAPTION_LENGTH) {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "caption_too_long",
      message: `TikTok photo captions cannot exceed ${TIKTOK_MAX_PHOTO_CAPTION_LENGTH} characters.`,
      field: "text",
      limit: TIKTOK_MAX_PHOTO_CAPTION_LENGTH,
      actual: text.length,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
