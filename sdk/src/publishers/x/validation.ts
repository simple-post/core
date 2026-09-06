import twitterText from "twitter-text";

import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content, Media } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

/** Classic tweet length; longer posts require an X account that supports long posts (e.g. X Premium). */
export const X_STANDARD_POST_MAX_LENGTH = 280;
/** X long-post ceiling per X help (longer posts); posting still requires a capable account. */
export const X_LONG_POST_MAX_LENGTH = 25_000;
export const X_MAX_MEDIA_COUNT = 4;
export const X_MAX_VIDEOS = 1;
export const X_MAX_CASHTAGS = 1;
export const X_CASHTAG_LIMIT_MESSAGE =
  "X allows only one cashtag ($SYMBOL) per post, including repeated symbols. Remove the $ from additional mentions or put them in separate thread posts.";
export const X_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const X_MAX_GIF_SIZE_BYTES = 15 * 1024 * 1024;
export const X_MAX_VIDEO_SIZE_BYTES = 512 * 1024 * 1024;

/** X weights CJK and emoji and counts each URL as 23 characters. */
export function getXTextLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

function isGif(media: Media): boolean {
  const source = media.path ?? media.url;
  if (!source) return false;
  try {
    return new URL(source).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return source.split("?")[0].toLowerCase().endsWith(".gif");
  }
}

export const X_VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: X_LONG_POST_MAX_LENGTH, standardMaxLength: X_STANDARD_POST_MAX_LENGTH },
  media: { maxCount: X_MAX_MEDIA_COUNT, maxImages: X_MAX_MEDIA_COUNT, maxVideos: X_MAX_VIDEOS, allowsMixed: false },
  image: { maxSizeBytes: X_MAX_IMAGE_SIZE_BYTES },
  video: { maxSizeBytes: X_MAX_VIDEO_SIZE_BYTES },
  notes: [`Animated GIFs may be up to ${X_MAX_GIF_SIZE_BYTES / (1024 * 1024)} MB.`, X_CASHTAG_LIMIT_MESSAGE],
};

export function validateXContent(content: Content): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const text = content.text ?? "";
  const textLength = getXTextLength(text);
  const media = content.media ?? [];
  const mediaCount = media.length;
  const { images, videos } = countMedia(media);

  // Count occurrences, not unique symbols. URLs and currency amounts are not
  // cashtags. X's API rejects even two mentions of the same ticker.
  // eslint-disable-next-line unicorn/prefer-string-replace-all -- Also typechecked by the ES2020 server workspace.
  const cashtagText = text.replace(/https?:\/\/\S+/gi, "");
  const cashtags = cashtagText.match(/(?<![\p{L}\p{N}_])\$[a-z]{1,6}(?:[._][a-z]{1,2})?(?![\p{L}\p{N}_])/giu) ?? [];
  if (cashtags.length > X_MAX_CASHTAGS) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "too_many_cashtags",
      message: X_CASHTAG_LIMIT_MESSAGE,
      field: "text",
      limit: X_MAX_CASHTAGS,
      actual: cashtags.length,
    });
  }

  if (!text.trim() && mediaCount === 0) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "content_required",
      message: "X posts require text or media.",
      field: "text",
    });
  }

  if (textLength > X_LONG_POST_MAX_LENGTH) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "text_too_long",
      message: `X text cannot exceed ${X_LONG_POST_MAX_LENGTH.toLocaleString("en-US")} weighted characters.`,
      field: "text",
      limit: X_LONG_POST_MAX_LENGTH,
      actual: textLength,
    });
  } else if (textLength > X_STANDARD_POST_MAX_LENGTH) {
    warnings.push({
      platform: "x",
      severity: "warning",
      code: "long_post",
      message: `X counts this post as ${textLength} characters, which requires X Premium long-post access. Shorten it to ${X_STANDARD_POST_MAX_LENGTH} weighted characters or split it into a thread if the account is not eligible.`,
      field: "text",
      limit: X_STANDARD_POST_MAX_LENGTH,
      actual: textLength,
    });
  }

  for (const item of media) {
    if (!hasMediaSource(item)) {
      errors.push({
        platform: "x",
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
      platform: "x",
      severity: "error",
      code: "mixed_media_not_supported",
      message: "X posts cannot mix images and videos.",
      field: "media",
    });
  }

  if (videos > X_MAX_VIDEOS) {
    errors.push({
      platform: "x",
      severity: "error",
      code: "too_many_videos",
      message: "X supports only one video per post.",
      field: "media",
      limit: X_MAX_VIDEOS,
      actual: videos,
    });
  }

  if (images > X_MAX_MEDIA_COUNT) {
    warnings.push({
      platform: "x",
      severity: "warning",
      code: "too_many_images",
      message: `X supports up to ${X_MAX_MEDIA_COUNT} images. Only the first ${X_MAX_MEDIA_COUNT} will be posted.`,
      field: "media",
      limit: X_MAX_MEDIA_COUNT,
      actual: images,
    });
  }

  errors.push(
    ...validateMediaSizes("x", "X", media, {
      image: (item) => (isGif(item) ? X_MAX_GIF_SIZE_BYTES : X_MAX_IMAGE_SIZE_BYTES),
      video: X_MAX_VIDEO_SIZE_BYTES,
    }),
  );

  return { errors, warnings, isValid: errors.length === 0 };
}
