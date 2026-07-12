import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const REDDIT_MAX_TITLE_LENGTH = 300;
export const REDDIT_MAX_MEDIA_COUNT = 1;

export const REDDIT_VALIDATION_RULES: PlatformValidationRules = {
  media: { maxCount: REDDIT_MAX_MEDIA_COUNT, allowsMixed: false },
};

export function validateRedditContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const media = content.media ?? [];

  if (media.some((item) => item.type === "video")) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "video_not_supported",
      message: "Reddit video uploads are not supported yet. Use a text, link, or image post.",
      field: "media",
    });
  }

  if (media.length > REDDIT_MAX_MEDIA_COUNT) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "too_many_media",
      message: "Reddit supports one image per post through SimplePost.",
      field: "media",
      limit: REDDIT_MAX_MEDIA_COUNT,
      actual: media.length,
    });
  }

  if (media.some((item) => item.type === "image" && !item.url)) {
    errors.push({
      platform: "reddit",
      severity: "error",
      code: "media_url_required",
      message:
        "Reddit images must be provided as a persistent public URL; Reddit links to the URL directly and does not rehost it.",
      field: "media",
    });
  }

  if (content.text && media.length > 0) {
    warnings.push({
      platform: "reddit",
      severity: "warning",
      code: "image_body_omitted",
      message: "Reddit image submissions are published as link posts; body text is not included.",
      field: "text",
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
