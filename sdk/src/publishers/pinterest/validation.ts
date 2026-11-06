import { describeDisplayMessage } from "../../validation/display-message";
import { hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content, PinterestOptions } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const PINTEREST_MAX_TITLE_LENGTH = 100;
export const PINTEREST_MAX_DESCRIPTION_LENGTH = 800;
export const PINTEREST_MAX_MEDIA_COUNT = 1;
export const PINTEREST_MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
export const PINTEREST_MAX_VIDEO_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export const PINTEREST_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: PINTEREST_MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxCount: PINTEREST_MAX_MEDIA_COUNT, allowsMixed: false },
  image: { maxSizeBytes: PINTEREST_MAX_IMAGE_SIZE_BYTES },
  video: { maxSizeBytes: PINTEREST_MAX_VIDEO_SIZE_BYTES },
};

export function validatePinterestContent(content: Content, options?: PinterestOptions): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = options?.description ?? content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;

  if (mediaCount === 0) {
    errors.push(
      describeDisplayMessage(
        {
          platform: "pinterest",
          severity: "error",
          code: "media_required",
          message: "Pinterest posts require at least one media item.",
          field: "media",
        },
        "Pinterest posts require at least one media item.",
      ),
    );
  }

  if (text.length > PINTEREST_MAX_DESCRIPTION_LENGTH) {
    errors.push(
      describeDisplayMessage(
        {
          platform: "pinterest",
          severity: "error",
          code: "description_too_long",
          message: `Pinterest descriptions cannot exceed ${PINTEREST_MAX_DESCRIPTION_LENGTH} characters.`,
          field: "text",
          limit: PINTEREST_MAX_DESCRIPTION_LENGTH,
          actual: text.length,
        },
        "Pinterest descriptions cannot exceed {{PINTEREST_MAX_DESCRIPTION_LENGTH}} characters.",
        { PINTEREST_MAX_DESCRIPTION_LENGTH: String(PINTEREST_MAX_DESCRIPTION_LENGTH) },
      ),
    );
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push(
        describeDisplayMessage(
          {
            platform: "pinterest",
            severity: "error",
            code: "media_source_missing",
            message: "Media must have either a path or url.",
            field: "media",
          },
          "Media must have either a path or url.",
        ),
      );
      break;
    }
  }

  if (mediaCount > PINTEREST_MAX_MEDIA_COUNT) {
    warnings.push(
      describeDisplayMessage(
        {
          platform: "pinterest",
          severity: "warning",
          code: "too_many_media",
          message: "Pinterest supports only one media item per pin. Only the first will be posted.",
          field: "media",
          limit: PINTEREST_MAX_MEDIA_COUNT,
          actual: mediaCount,
        },
        "Pinterest supports only one media item per pin. Only the first will be posted.",
      ),
    );
  }

  errors.push(
    ...validateMediaSizes("pinterest", "Pinterest", media, {
      image: PINTEREST_MAX_IMAGE_SIZE_BYTES,
      video: PINTEREST_MAX_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
