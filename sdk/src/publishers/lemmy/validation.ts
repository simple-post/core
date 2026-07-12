import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
export const LEMMY_MAX_BODY_LENGTH = 10_000;
export const LEMMY_MAX_MEDIA_COUNT = 10;
export const LEMMY_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: LEMMY_MAX_BODY_LENGTH },
  media: { maxCount: LEMMY_MAX_MEDIA_COUNT, allowsMixed: true },
};
export function validateLemmyContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  if (!text.trim() && media.length === 0)
    errors.push({
      platform: "lemmy",
      severity: "error",
      code: "content_required",
      message: "Lemmy posts require text or media.",
      field: "text",
    });
  if (text.length > LEMMY_MAX_BODY_LENGTH)
    errors.push({
      platform: "lemmy",
      severity: "error",
      code: "text_too_long",
      message: `Lemmy post bodies cannot exceed ${LEMMY_MAX_BODY_LENGTH} characters in SimplePost.`,
      field: "text",
      limit: LEMMY_MAX_BODY_LENGTH,
      actual: text.length,
    });
  if (media.length > LEMMY_MAX_MEDIA_COUNT)
    errors.push({
      platform: "lemmy",
      severity: "error",
      code: "too_many_media",
      message: `Lemmy supports at most ${LEMMY_MAX_MEDIA_COUNT} media URLs.`,
      field: "media",
      limit: LEMMY_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  if (media.some((item) => !item.url))
    errors.push({
      platform: "lemmy",
      severity: "error",
      code: "media_url_required",
      message: "Lemmy media must use public URLs.",
      field: "media",
    });
  return { errors, warnings, isValid: errors.length === 0 };
}
