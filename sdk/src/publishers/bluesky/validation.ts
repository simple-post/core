import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const BLUESKY_MAX_TEXT_LENGTH = 300;
export const BLUESKY_MAX_IMAGES = 4;
export const BLUESKY_MAX_IMAGE_SIZE_BYTES = 2_000_000;
// https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts
export const BLUESKY_MAX_VIDEO_SIZE_BYTES = 300_000_000;
export const BLUESKY_MAX_VIDEO_DURATION_SEC = 600;

export const BLUESKY_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: BLUESKY_MAX_TEXT_LENGTH },
  media: { maxCount: BLUESKY_MAX_IMAGES, maxImages: BLUESKY_MAX_IMAGES, maxVideos: 1, allowsMixed: false },
  image: { maxSizeBytes: BLUESKY_MAX_IMAGE_SIZE_BYTES },
  video: { maxSizeBytes: BLUESKY_MAX_VIDEO_SIZE_BYTES, maxDurationSec: BLUESKY_MAX_VIDEO_DURATION_SEC },
  notes: [
    "Up to 4 images or 1 MP4 video (300 MB, 10 minutes). Video uploads require a verified Bluesky email and available account quota.",
  ],
};

export function validateBlueskyContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "content_required",
      message: "Bluesky posts require text, images, or a video.",
      field: "text",
    });
  }

  if (text.length > BLUESKY_MAX_TEXT_LENGTH) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "text_too_long",
      message: `Bluesky text cannot exceed ${BLUESKY_MAX_TEXT_LENGTH} characters.`,
      field: "text",
      limit: BLUESKY_MAX_TEXT_LENGTH,
      actual: text.length,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "media_source_missing",
        message: "Media must have either a path or url.",
        field: "media",
      });
      break;
    }
  }

  if (videos > 1) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "too_many_videos",
      message: "Bluesky supports only one video per post.",
      field: "media",
      limit: 1,
      actual: videos,
    });
  }

  if (videos > 0 && images > 0) {
    errors.push({
      platform: "bluesky",
      severity: "error",
      code: "mixed_media_not_supported",
      message: "Bluesky posts cannot mix images and video.",
      field: "media",
    });
  }

  if (images > BLUESKY_MAX_IMAGES) {
    warnings.push({
      platform: "bluesky",
      severity: "warning",
      code: "too_many_images",
      message: `Bluesky supports up to ${BLUESKY_MAX_IMAGES} images. Only the first ${BLUESKY_MAX_IMAGES} will be posted.`,
      field: "media",
      limit: BLUESKY_MAX_IMAGES,
      actual: images,
    });
  }

  for (const [index, item] of media.entries()) {
    if (item.type !== "video") continue;
    if (item.durationSec !== undefined && item.durationSec > BLUESKY_MAX_VIDEO_DURATION_SEC) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "video_too_long",
        message: "Bluesky videos cannot exceed 10 minutes.",
        field: `media[${index}]`,
        limit: BLUESKY_MAX_VIDEO_DURATION_SEC,
        actual: item.durationSec,
      });
    }
    // Extensionless URLs are resolved and checked after download.
    const source = item.path || item.url || "";
    let pathname = source;
    try {
      pathname = new URL(source).pathname;
    } catch {
      /* Local path. */
    }
    const extension = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();
    if (extension && extension !== "mp4" && extension !== "m4v") {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "video_format_not_supported",
        message: "Bluesky videos must be MP4 files.",
        field: `media[${index}]`,
      });
    }
  }

  errors.push(
    ...validateMediaSizes("bluesky", "Bluesky", media, {
      image: BLUESKY_MAX_IMAGE_SIZE_BYTES,
      video: BLUESKY_MAX_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
