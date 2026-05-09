import { countMedia, hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

/** Classic tweet length; longer posts require an X account that supports long posts (e.g. X Premium). */
export const X_STANDARD_POST_MAX_LENGTH = 280;
/** X long-post ceiling per X help (longer posts); posting still requires a capable account. */
export const X_LONG_POST_MAX_LENGTH = 25_000;
export const X_MAX_MEDIA_COUNT = 4;
export const X_MAX_VIDEOS = 1;

export const X_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: X_LONG_POST_MAX_LENGTH, standardMaxLength: X_STANDARD_POST_MAX_LENGTH },
  media: { maxCount: X_MAX_MEDIA_COUNT, maxImages: X_MAX_MEDIA_COUNT, maxVideos: X_MAX_VIDEOS, allowsMixed: false },
};

export function validateXContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "content_required",
      message: "X posts require text or media.",
      field: "text",
    });
  }

  if (text.length > X_LONG_POST_MAX_LENGTH) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "text_too_long",
      message: `X text cannot exceed ${X_LONG_POST_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      field: "text",
      limit: X_LONG_POST_MAX_LENGTH,
      actual: text.length,
    });
  } else if (text.length > X_STANDARD_POST_MAX_LENGTH) {
    warnings.push({
      platform: "x",
      severity: "warning",
      code: "long_post",
      message: "Long X post. Premium may be required.",
      field: "text",
      limit: X_LONG_POST_MAX_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "x",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 0 && images > 0) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "mixed_media_not_supported",
      message: "X posts cannot mix images and videos.",
      field: "media",
    });
  }

  if (videos > X_MAX_VIDEOS) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "too_many_videos",
      message: "X supports only one video per post.",
      field: "media",
      limit: X_MAX_VIDEOS,
      actual: videos,
    });
  }

  if (images > X_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "x",
      severity: "warning",
      code: "too_many_images",
      message: `X supports up to ${X_MAX_MEDIA_COUNT} images. Only the first ${X_MAX_MEDIA_COUNT} will be posted.`,
      field: "media",
      limit: X_MAX_MEDIA_COUNT,
      actual: images,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
