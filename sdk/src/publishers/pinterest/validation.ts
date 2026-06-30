import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const PINTEREST_MAX_TITLE_LENGTH = 100;
export const PINTEREST_MAX_DESCRIPTION_LENGTH = 500;
export const PINTEREST_MAX_MEDIA_COUNT = 1;

export const PINTEREST_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: PINTEREST_MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxCount: PINTEREST_MAX_MEDIA_COUNT, allowsMixed: false },
};

export function validatePinterestContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  if (mediaCount === 0) {
    errors.push({
      platform: "pinterest",
      severity: "error",
      code: "media_required",
      message: "Pinterest posts require at least one media item.",
      field: "media",
    });
  }

  if (text.length > PINTEREST_MAX_DESCRIPTION_LENGTH) {
    errors.push({
      platform: "pinterest",
      severity: "error",
      code: "description_too_long",
      message: `Pinterest descriptions cannot exceed ${PINTEREST_MAX_DESCRIPTION_LENGTH} characters.`,
      field: "text",
      limit: PINTEREST_MAX_DESCRIPTION_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "pinterest",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (mediaCount > PINTEREST_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "pinterest",
      severity: "warning",
      code: "too_many_media",
      message: "Pinterest supports only one media item per pin. Only the first will be posted.",
      field: "media",
      limit: PINTEREST_MAX_MEDIA_COUNT,
      actual: mediaCount,
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
