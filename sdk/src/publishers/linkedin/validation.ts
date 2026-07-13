import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const LINKEDIN_MAX_TEXT_LENGTH = 3000;
export const LINKEDIN_MAX_IMAGES = 9;
export const LINKEDIN_MAX_VIDEOS = 1;
export const LINKEDIN_MAX_SINGLE_UPLOAD_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;

export const LINKEDIN_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: LINKEDIN_MAX_TEXT_LENGTH },
  media: {
    maxCount: LINKEDIN_MAX_IMAGES,
    maxImages: LINKEDIN_MAX_IMAGES,
    maxVideos: LINKEDIN_MAX_VIDEOS,
    allowsMixed: false,
  },
  video: { maxSizeBytes: LINKEDIN_MAX_SINGLE_UPLOAD_VIDEO_SIZE_BYTES },
  notes: [
    "LinkedIn allows larger multipart video uploads, but this publisher currently uses the single-request Assets API upload.",
    "LinkedIn documents an image pixel-count limit, but not a maximum image byte size.",
  ],
};

export function validateLinkedInContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "linkedin",
      severity: "error",
      code: "content_required",
      message: "LinkedIn posts require text or media.",
      field: "text",
    });
  }

  if (text.length > LINKEDIN_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "linkedin",
      severity: "error",
      code: "text_too_long",
      message: `LinkedIn text cannot exceed ${LINKEDIN_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: LINKEDIN_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "linkedin",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 0 && images > 0) {
    errors.push({
      platform: "linkedin",
      severity: "error",
      code: "mixed_media_not_supported",
      message: "LinkedIn posts cannot mix images and videos.",
      field: "media",
    });
  }

  if (videos > LINKEDIN_MAX_VIDEOS) {
    errors.push({
      platform: "linkedin",
      severity: "error",
      code: "too_many_videos",
      message: "LinkedIn supports only one video per post.",
      field: "media",
      limit: LINKEDIN_MAX_VIDEOS,
      actual: videos,
    });
  }

  if (images > LINKEDIN_MAX_IMAGES) {
    warnings.push({
      platform: "linkedin",
      severity: "warning",
      code: "too_many_images",
      message: `LinkedIn supports up to ${LINKEDIN_MAX_IMAGES} images. Only the first ${LINKEDIN_MAX_IMAGES} will be posted.`,
      field: "media",
      limit: LINKEDIN_MAX_IMAGES,
      actual: images,
    });
  }

  errors.push(
    ...validateMediaSizes("linkedin", "LinkedIn", media, {
      video: LINKEDIN_MAX_SINGLE_UPLOAD_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
