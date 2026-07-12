import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const NOSTR_MAX_TEXT_LENGTH = 10_000;
export const NOSTR_MAX_MEDIA_COUNT = 10;

export const NOSTR_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: NOSTR_MAX_TEXT_LENGTH },
  media: { maxCount: NOSTR_MAX_MEDIA_COUNT, allowsMixed: true },
};

export function validateNostrContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  if (!text.trim() && media.length === 0) {
    errors.push({
      platform: "nostr",
      severity: "error",
      code: "content_required",
      message: "Nostr notes require text or media.",
      field: "text",
    });
  }
  if (text.length > NOSTR_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "nostr",
      severity: "error",
      code: "text_too_long",
      message: `Nostr notes cannot exceed ${NOSTR_MAX_TEXT_LENGTH} characters in SimplePost.`,
      field: "text",
      limit: NOSTR_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }
  if (media.length > NOSTR_MAX_MEDIA_COUNT) {
    errors.push({
      platform: "nostr",
      severity: "error",
      code: "too_many_media",
      message: `Nostr supports at most ${NOSTR_MAX_MEDIA_COUNT} media URLs per note.`,
      field: "media",
      limit: NOSTR_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  }
  if (media.some((item) => !hasMediaSource(item))) {
    errors.push({
      platform: "nostr",
      severity: "error",
      code: "media_source_missing",
      message: "Nostr media must have a public URL.",
      field: "media",
    });
  }
  if (media.some((item) => !item.url)) {
    errors.push({
      platform: "nostr",
      severity: "error",
      code: "media_url_required",
      message: "Nostr does not upload local media; every attachment must use a public URL.",
      field: "media",
    });
  }
  return { errors, warnings, isValid: errors.length === 0 };
}
