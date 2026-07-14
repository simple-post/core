import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
export const FARCASTER_MAX_TEXT_BYTES = 1024;
export const FARCASTER_MAX_EMBEDS = 2;
export const FARCASTER_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: FARCASTER_MAX_TEXT_BYTES },
  media: { maxCount: FARCASTER_MAX_EMBEDS, allowsMixed: true },
};
export function validateFarcasterContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const bytes = Buffer.byteLength(text, "utf8");
  if (!text.trim() && media.length === 0)
    errors.push({
      platform: "farcaster",
      severity: "error",
      code: "content_required",
      message: "Farcaster casts require text or an embed.",
      field: "text",
    });
  if (bytes > FARCASTER_MAX_TEXT_BYTES)
    errors.push({
      platform: "farcaster",
      severity: "error",
      code: "text_too_long",
      message: `Farcaster casts cannot exceed ${FARCASTER_MAX_TEXT_BYTES} UTF-8 bytes.`,
      field: "text",
      limit: FARCASTER_MAX_TEXT_BYTES,
      actual: bytes,
    });
  if (media.length > FARCASTER_MAX_EMBEDS)
    errors.push({
      platform: "farcaster",
      severity: "error",
      code: "too_many_media",
      message: `Farcaster casts support at most ${FARCASTER_MAX_EMBEDS} embeds.`,
      field: "media",
      limit: FARCASTER_MAX_EMBEDS,
      actual: media.length,
    });
  if (media.some((item) => !item.url))
    errors.push({
      platform: "farcaster",
      severity: "error",
      code: "media_url_required",
      message: "Farcaster media must use public URLs.",
      field: "media",
    });
  return { errors, warnings, isValid: errors.length === 0 };
}
