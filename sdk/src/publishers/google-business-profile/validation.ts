import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const GOOGLE_BUSINESS_PROFILE_MAX_TEXT_LENGTH = 1500;
export const GOOGLE_BUSINESS_PROFILE_MAX_MEDIA_COUNT = 10;
export const GOOGLE_BUSINESS_PROFILE_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: GOOGLE_BUSINESS_PROFILE_MAX_TEXT_LENGTH },
  media: { maxCount: GOOGLE_BUSINESS_PROFILE_MAX_MEDIA_COUNT, allowsMixed: true },
};

export function validateGoogleBusinessProfileContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  if (!text.trim() && media.length === 0)
    errors.push({
      platform: "google_business_profile",
      severity: "error",
      code: "content_required",
      message: "Google Business Profile posts require text or media.",
      field: "text",
    });
  if (text.length > GOOGLE_BUSINESS_PROFILE_MAX_TEXT_LENGTH)
    errors.push({
      platform: "google_business_profile",
      severity: "error",
      code: "text_too_long",
      message: `Google Business Profile summaries cannot exceed ${GOOGLE_BUSINESS_PROFILE_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: GOOGLE_BUSINESS_PROFILE_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  if (media.length > GOOGLE_BUSINESS_PROFILE_MAX_MEDIA_COUNT)
    errors.push({
      platform: "google_business_profile",
      severity: "error",
      code: "too_many_media",
      message: `Google Business Profile supports at most ${GOOGLE_BUSINESS_PROFILE_MAX_MEDIA_COUNT} media items.`,
      field: "media",
      limit: GOOGLE_BUSINESS_PROFILE_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  if (media.some((item) => !hasMediaSource(item) || !item.url))
    errors.push({
      platform: "google_business_profile",
      severity: "error",
      code: "media_url_required",
      message: "Google Business Profile media must use public URLs.",
      field: "media",
    });
  return { errors, warnings, isValid: errors.length === 0 };
}
