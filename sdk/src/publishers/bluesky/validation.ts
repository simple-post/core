import { countMedia, hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const BLUESKY_MAX_TEXT_LENGTH = 300;
export const BLUESKY_MAX_IMAGES = 4;

export const BLUESKY_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: BLUESKY_MAX_TEXT_LENGTH },
  media: { maxCount: BLUESKY_MAX_IMAGES, maxImages: BLUESKY_MAX_IMAGES, maxVideos: 0, allowsMixed: false },
};

export function validateBlueskyContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "content_required",
      message: "Bluesky posts require text or images.",
      field: "text",
    });
  }

  if (text.length > BLUESKY_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "text_too_long",
      message: `Bluesky text cannot exceed ${BLUESKY_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: BLUESKY_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 0) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "video_not_supported",
      message: "Bluesky publisher currently supports images only.",
      field: "media",
    });
  }

  if (images > BLUESKY_MAX_IMAGES) {
    warnings.push({
      platform: "bluesky",
      severity: "warning",
      code: "too_many_images",
      message: `Bluesky supports up to ${BLUESKY_MAX_IMAGES} images. Only the first ${BLUESKY_MAX_IMAGES} will be posted.`,
      field: "media",
      limit: BLUESKY_MAX_IMAGES,
      actual: images,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
