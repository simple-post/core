import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const FACEBOOK_MAX_TEXT_LENGTH = 63_206;
export const FACEBOOK_MAX_MEDIA_COUNT = 10;
export const FACEBOOK_MAX_VIDEOS = 1;
export const FACEBOOK_MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
export const FACEBOOK_MAX_VIDEO_SIZE_BYTES = 4 * 1024 * 1024 * 1024;

export const FACEBOOK_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: FACEBOOK_MAX_TEXT_LENGTH },
  media: {
    maxCount: FACEBOOK_MAX_MEDIA_COUNT,
    maxImages: FACEBOOK_MAX_MEDIA_COUNT,
    maxVideos: FACEBOOK_MAX_VIDEOS,
    allowsMixed: false,
  },
  image: { maxSizeBytes: FACEBOOK_MAX_IMAGE_SIZE_BYTES },
  video: { maxSizeBytes: FACEBOOK_MAX_VIDEO_SIZE_BYTES },
};

export function validateFacebookContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "facebook",
      severity: "error",
      code: "content_required",
      message: "Facebook posts require text or media.",
      field: "text",
    });
  }

  if (text.length > FACEBOOK_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "facebook",
      severity: "error",
      code: "text_too_long",
      message: `Facebook text cannot exceed ${FACEBOOK_MAX_TEXT_LENGTH.toLocaleString()} characters.`,
      field: "text",
      limit: FACEBOOK_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "facebook",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 0 && mediaCount > 1) {
    errors.push({
      platform: "facebook",
      severity: "error",
      code: "video_with_other_media",
      message: "Facebook video posts can only contain a single video.",
      field: "media",
    });
  }

  if (videos > FACEBOOK_MAX_VIDEOS) {
    errors.push({
      platform: "facebook",
      severity: "error",
      code: "too_many_videos",
      message: "Facebook supports only one video per post.",
      field: "media",
      limit: FACEBOOK_MAX_VIDEOS,
      actual: videos,
    });
  }

  if (images > FACEBOOK_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "facebook",
      severity: "warning",
      code: "too_many_images",
      message: `Facebook supports up to ${FACEBOOK_MAX_MEDIA_COUNT} images. Only the first ${FACEBOOK_MAX_MEDIA_COUNT} will be posted.`,
      field: "media",
      limit: FACEBOOK_MAX_MEDIA_COUNT,
      actual: images,
    });
  }

  errors.push(
    ...validateMediaSizes("facebook", "Facebook", media, {
      image: FACEBOOK_MAX_IMAGE_SIZE_BYTES,
      video: FACEBOOK_MAX_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
