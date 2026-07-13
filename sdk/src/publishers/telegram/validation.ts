import { hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const TELEGRAM_MAX_TEXT_LENGTH = 4096;
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024;
export const TELEGRAM_MAX_MEDIA_COUNT = 1;
export const TELEGRAM_MAX_URL_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
export const TELEGRAM_MAX_URL_VIDEO_SIZE_BYTES = 20 * 1024 * 1024;
export const TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
export const TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

export const TELEGRAM_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: TELEGRAM_MAX_TEXT_LENGTH, maxCaptionLength: TELEGRAM_MAX_CAPTION_LENGTH },
  media: { maxCount: TELEGRAM_MAX_MEDIA_COUNT },
  image: { maxSizeBytes: TELEGRAM_MAX_URL_PHOTO_SIZE_BYTES },
  video: { maxSizeBytes: TELEGRAM_MAX_URL_VIDEO_SIZE_BYTES },
  notes: ["Direct multipart uploads allow photos up to 10 MB and videos up to 50 MB."],
};

export function validateTelegramContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "telegram",
      severity: "error",
      code: "content_required",
      message: "Telegram posts require text or media.",
      field: "text",
    });
  }

  if (mediaCount > 0) {
    if (text.length > TELEGRAM_MAX_CAPTION_LENGTH) {
      errors.push({
        platform: "telegram",
        severity: "error",
        code: "caption_too_long",
        message: `Telegram media captions cannot exceed ${TELEGRAM_MAX_CAPTION_LENGTH} characters.`,
        field: "text",
        limit: TELEGRAM_MAX_CAPTION_LENGTH,
        actual: text.length,
      });
    }
  } else if (text.length > TELEGRAM_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "telegram",
      severity: "error",
      code: "text_too_long",
      message: `Telegram messages cannot exceed ${TELEGRAM_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: TELEGRAM_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "telegram",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (mediaCount > TELEGRAM_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "telegram",
      severity: "warning",
      code: "too_many_media",
      message: "Telegram supports only one media item per message. Only the first media will be sent.",
      field: "media",
      limit: TELEGRAM_MAX_MEDIA_COUNT,
      actual: mediaCount,
    });
  }

  errors.push(
    ...validateMediaSizes("telegram", "Telegram", media, {
      image: (item) => (item.url ? TELEGRAM_MAX_URL_PHOTO_SIZE_BYTES : TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES),
      video: (item) => (item.url ? TELEGRAM_MAX_URL_VIDEO_SIZE_BYTES : TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES),
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
