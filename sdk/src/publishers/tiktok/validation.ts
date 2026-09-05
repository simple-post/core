import { TikTokOptionsSchema } from "../../types/post";
import { countMedia, hasMediaSource, validateMediaSizes } from "../validation-utils";

import type { Content, TikTokOptions } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

export const TIKTOK_MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024;
export const TIKTOK_MAX_PHOTO_SIZE = 20 * 1024 * 1024;
export const TIKTOK_MAX_VIDEO_CAPTION_LENGTH = 2200;
export const TIKTOK_MAX_PHOTO_TITLE_LENGTH = 90;
export const TIKTOK_MAX_PHOTO_CAPTION_LENGTH = 4000;
export const TIKTOK_MAX_MEDIA_COUNT = 35;

export const TIKTOK_VALIDATION_RULES: PlatformValidationRules = {
  text: {
    maxCaptionLengthByMediaType: { video: TIKTOK_MAX_VIDEO_CAPTION_LENGTH, image: TIKTOK_MAX_PHOTO_CAPTION_LENGTH },
  },
  media: {
    requiresMedia: true,
    minCount: 1,
    maxCount: TIKTOK_MAX_MEDIA_COUNT,
    maxImages: 35,
    maxVideos: 1,
    allowsMixed: false,
  },
  video: { maxSizeBytes: TIKTOK_MAX_VIDEO_SIZE },
  image: { maxSizeBytes: TIKTOK_MAX_PHOTO_SIZE },
  notes: [
    "Photos: JPEG/WebP, maximum 1080p, served over HTTPS from a TikTok-verified domain or URL prefix. Up to 35 photos or one video; no mixed media.",
  ],
};

/** Resolves exactly the text sent to TikTok, shared by validation and publishing. */
export function getTikTokPostText(content: Content, options: TikTokOptions = {}) {
  const media = content.media?.[0];
  if (media?.type === "image") {
    // TikTok displays a separate photo title. Keep the complete message and
    // hashtags in description, and derive a short title without splitting emoji.
    const defaultTitle = (content.text ?? "").slice(0, TIKTOK_MAX_PHOTO_TITLE_LENGTH).replace(/[\uD800-\uDBFF]$/, "");
    return {
      title: options.title ?? media.caption ?? defaultTitle,
      description: options.description ?? content.text ?? "",
    };
  }
  return {
    title:
      options.title ??
      (media?.type === "video" && media.title
        ? [media.title, media.description].filter(Boolean).join("\n\n")
        : (content.text ?? "")),
  };
}

export function validateTikTokContent(content: Content, options: TikTokOptions = {}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const media = content.media ?? [];
  const { images, videos } = countMedia(media);
  const add = (code: string, message: string, field: string, limit?: number, actual?: number) => {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code,
      message,
      field,
      ...(limit === undefined ? {} : { limit, actual }),
    });
  };
  const parsed = TikTokOptionsSchema.safeParse(options);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      add("invalid_option", issue.message, `options.tiktok.${issue.path.join(".")}`);
    return { errors, warnings, isValid: false };
  }
  if (media.length === 0) add("media_required", "TikTok posts require at least one media item.", "media");
  if (images && videos) add("mixed_media", "TikTok posts cannot mix photos and videos.", "media");
  if (videos > 1) add("too_many_media", "TikTok video posts support exactly one video.", "media", 1, videos);
  if (images > 35) add("too_many_media", "TikTok photo posts support up to 35 images.", "media", 35, images);
  for (const [index, item] of media.entries()) {
    if (!hasMediaSource(item)) add("media_source_missing", "Media must have either a path or url.", `media[${index}]`);
    if (item.type !== "image") continue;
    let source = item.path ?? "";
    if (item.url && !item.path) {
      try {
        const url = new URL(item.url);
        if (url.protocol !== "https:" || url.username || url.password)
          add(
            "photo_url_invalid",
            "TikTok photos require a public HTTPS URL without credentials.",
            `media[${index}].url`,
          );
        source = url.pathname;
      } catch {
        add("photo_url_invalid", "TikTok photos require a valid HTTPS URL.", `media[${index}].url`);
      }
    }
    const extension = source
      .split("/")
      .pop()
      ?.match(/\.([a-z0-9]+)$/i)?.[1]
      .toLowerCase();
    if (extension && !["jpg", "jpeg", "webp"].includes(extension))
      add(
        "photo_format_unsupported",
        "TikTok photos must be JPEG or WebP. Convert this image before posting.",
        `media[${index}]`,
      );
  }
  const text = getTikTokPostText(content, options);
  const titleLimit = images ? TIKTOK_MAX_PHOTO_TITLE_LENGTH : TIKTOK_MAX_VIDEO_CAPTION_LENGTH;
  if (text.title.length > titleLimit)
    add(
      "caption_too_long",
      `TikTok ${images ? "photo titles" : "video captions"} cannot exceed ${titleLimit} characters.`,
      options.title === undefined ? (images ? "media[0].caption" : "text") : "options.tiktok.title",
      titleLimit,
      text.title.length,
    );
  if (text.description && text.description.length > TIKTOK_MAX_PHOTO_CAPTION_LENGTH)
    add(
      "caption_too_long",
      "TikTok photo descriptions cannot exceed 4000 characters.",
      options.description === undefined ? "text" : "options.tiktok.description",
      4000,
      text.description.length,
    );
  if (options.photoCoverIndex !== undefined && (!images || options.photoCoverIndex >= images))
    add(
      "photo_cover_invalid",
      "Choose a cover index within the attached photos (starting at 0).",
      "options.tiktok.photoCoverIndex",
    );
  if (options.autoAddMusic === true && (!images || videos || options.publishMode === "draft"))
    add(
      "auto_music_unavailable",
      "Automatic music is available only for directly published photo posts. Turn it off to upload to the TikTok inbox and add music manually.",
      "options.tiktok.autoAddMusic",
    );
  errors.push(
    ...validateMediaSizes("tiktok", "TikTok", media, { image: TIKTOK_MAX_PHOTO_SIZE, video: TIKTOK_MAX_VIDEO_SIZE }),
  );
  return { errors, warnings, isValid: errors.length === 0 };
}
