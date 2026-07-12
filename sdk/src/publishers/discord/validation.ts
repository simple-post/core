import { hasMediaSource } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const DISCORD_MAX_TEXT_LENGTH = 2000;
export const DISCORD_MAX_MEDIA_COUNT = 10;

export const DISCORD_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: DISCORD_MAX_TEXT_LENGTH },
  media: { maxCount: DISCORD_MAX_MEDIA_COUNT, allowsMixed: true },
};

export function validateDiscordContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  if (!text.trim() && media.length === 0) {
    errors.push({
      platform: "discord",
      severity: "error",
      code: "content_required",
      message: "Discord messages require text or media.",
      field: "text",
    });
  }
  if (text.length > DISCORD_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "discord",
      severity: "error",
      code: "text_too_long",
      message: `Discord messages cannot exceed ${DISCORD_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: DISCORD_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }
  if (media.length > DISCORD_MAX_MEDIA_COUNT) {
    errors.push({
      platform: "discord",
      severity: "error",
      code: "too_many_media",
      message: `Discord supports at most ${DISCORD_MAX_MEDIA_COUNT} attachments per message.`,
      field: "media",
      limit: DISCORD_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  }
  if (media.some((item) => !hasMediaSource(item))) {
    errors.push({
      platform: "discord",
      severity: "error",
      code: "media_source_missing",
      message: "Discord media must have either a path or URL.",
      field: "media",
    });
  }
  return { errors, warnings, isValid: errors.length === 0 };
}
