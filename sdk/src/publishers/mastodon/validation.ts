import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const MASTODON_DEFAULT_MAX_TEXT_LENGTH = 500;
export const MASTODON_MAX_MEDIA_COUNT = 4;

export const MASTODON_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: MASTODON_DEFAULT_MAX_TEXT_LENGTH },
  media: { maxCount: MASTODON_MAX_MEDIA_COUNT, allowsMixed: true },
};

export function validateMastodonContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];

  if (!text.trim() && media.length === 0) {
    errors.push({
      platform: "mastodon",
      severity: "error",
      code: "content_required",
      message: "Mastodon statuses require text or media.",
      field: "text",
    });
  }
  if (text.length > MASTODON_DEFAULT_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "mastodon",
      severity: "error",
      code: "text_too_long",
      message: `Mastodon statuses cannot exceed ${MASTODON_DEFAULT_MAX_TEXT_LENGTH} characters on standard instances.`,
      field: "text",
      limit: MASTODON_DEFAULT_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }
  if (media.length > MASTODON_MAX_MEDIA_COUNT) {
    errors.push({
      platform: "mastodon",
      severity: "error",
      code: "too_many_media",
      message: `Mastodon supports at most ${MASTODON_MAX_MEDIA_COUNT} media attachments per status.`,
      field: "media",
      limit: MASTODON_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  }
  if (media.some((item) => !hasMediaSource(item))) {
    errors.push({
      platform: "mastodon",
      severity: "error",
      code: "media_source_missing",
      message: "Mastodon media must have either a path or URL.",
      field: "media",
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
