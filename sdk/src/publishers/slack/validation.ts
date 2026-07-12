import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const SLACK_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: 40_000, standardMaxLength: 4000 },
  media: { maxCount: 10, allowsMixed: true },
  notes: ["Slack recommends messages of 4,000 characters or fewer and truncates messages over 40,000 characters."],
};

export function validateSlackContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const textLength = content.text?.length ?? 0;
  const mediaCount = content.media?.length ?? 0;

  if (textLength === 0 && mediaCount === 0) {
    errors.push({
      platform: "slack",
      severity: "error",
      code: "content_required",
      message: "Slack messages require text or media.",
      field: "text",
    });
  }
  if (textLength > 40_000) {
    errors.push({
      platform: "slack",
      severity: "error",
      code: "text_too_long",
      message: "Slack messages cannot exceed 40,000 characters.",
      field: "text",
      limit: 40_000,
      actual: textLength,
    });
  } else if (textLength > 4000) {
    warnings.push({
      platform: "slack",
      severity: "warning",
      code: "text_above_recommended_length",
      message: "Slack recommends messages of 4,000 characters or fewer.",
      field: "text",
      limit: 4000,
      actual: textLength,
    });
  }
  if (mediaCount > 10) {
    errors.push({
      platform: "slack",
      severity: "error",
      code: "too_many_media",
      message: "SimplePost supports up to 10 Slack file uploads per message.",
      field: "media",
      limit: 10,
      actual: mediaCount,
    });
  }
  return { errors, warnings, isValid: errors.length === 0 };
}
