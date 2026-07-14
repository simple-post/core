import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
export const FOREM_MAX_BODY_LENGTH = 100_000;
export const FOREM_MAX_MEDIA_COUNT = 20;
export const FOREM_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: FOREM_MAX_BODY_LENGTH },
  media: { maxCount: FOREM_MAX_MEDIA_COUNT, allowsMixed: true },
};
export function validateForemContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  if (!text.trim() && media.length === 0)
    errors.push({
      platform: "forem",
      severity: "error",
      code: "content_required",
      message: "Forem articles require body text or media.",
      field: "text",
    });
  if (text.length > FOREM_MAX_BODY_LENGTH)
    errors.push({
      platform: "forem",
      severity: "error",
      code: "text_too_long",
      message: `Forem article bodies cannot exceed ${FOREM_MAX_BODY_LENGTH} characters in SimplePost.`,
      field: "text",
      limit: FOREM_MAX_BODY_LENGTH,
      actual: text.length,
    });
  if (media.length > FOREM_MAX_MEDIA_COUNT)
    errors.push({
      platform: "forem",
      severity: "error",
      code: "too_many_media",
      message: `Forem articles support at most ${FOREM_MAX_MEDIA_COUNT} media URLs in SimplePost.`,
      field: "media",
      limit: FOREM_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  if (media.some((item) => !item.url))
    errors.push({
      platform: "forem",
      severity: "error",
      code: "media_url_required",
      message: "Forem media must use public URLs.",
      field: "media",
    });
  return { errors, warnings, isValid: errors.length === 0 };
}
