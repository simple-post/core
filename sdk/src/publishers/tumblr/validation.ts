import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
export const TUMBLR_MAX_BLOCKS = 1000;
export const TUMBLR_VALIDATION_RULES: PlatformValidationRules = { media: { maxCount: 20, allowsMixed: true } };
export function validateTumblrContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const media = content.media ?? [];
  if (!(content.text ?? "").trim() && media.length === 0)
    errors.push({
      platform: "tumblr",
      severity: "error",
      code: "content_required",
      message: "Tumblr posts require text or media.",
      field: "text",
    });
  if (media.length > 20)
    errors.push({
      platform: "tumblr",
      severity: "error",
      code: "too_many_media",
      message: "SimplePost supports at most 20 Tumblr media blocks.",
      field: "media",
      limit: 20,
      actual: media.length,
    });
  if (media.some((item) => !item.url))
    errors.push({
      platform: "tumblr",
      severity: "error",
      code: "media_url_required",
      message: "Tumblr media must use public URLs.",
      field: "media",
    });
  return { errors, warnings, isValid: errors.length === 0 };
}
