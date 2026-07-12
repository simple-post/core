import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const REDDIT_MAX_TITLE_LENGTH = 300;
export const REDDIT_MAX_MEDIA_COUNT = 1;

export const REDDIT_VALIDATION_RULES: PlatformValidationRules = {
  media: { maxCount: REDDIT_MAX_MEDIA_COUNT, allowsMixed: false },
};

export function validateRedditContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const media = content.media ?? [];

  if (media.some((item) => item.type === "video")) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "video_not_supported",
      message: "Reddit video uploads are not supported yet. Use a text, link, or image post.",
      field: "media",
    });
  }

  if (media.length > REDDIT_MAX_MEDIA_COUNT) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "too_many_media",
      message: "Reddit supports one image per post through SimplePost.",
      field: "media",
      limit: REDDIT_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  }

  if (media.some((item) => !hasMediaSource(item))) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "media_source_missing",
      message: "Reddit image media must have either a path or URL.",
      field: "media",
    });
  }

  if (content.text && media.length > 0) {
    warnings.push({
      platform: "reddit",
      severity: "warning",
      code: "image_body_omitted",
      message: "Reddit image submissions use the image and title; body text is not included by the Data API.",
      field: "text",
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
