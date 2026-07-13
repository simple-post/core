import type { Media, Platform } from "../types/post";
import type { ValidationIssue } from "../types/validation";

type MediaSizeLimit = number | ((media: Media) => number | undefined);

export interface MediaSizeLimits {
  image?: MediaSizeLimit;
  video?: MediaSizeLimit;
}

export function hasMediaSource(media: Media): boolean {
  return Boolean(media.path || media.url);
}

export function countMedia(media: Media[]): { images: number; videos: number } {
  let images = 0;
  let videos = 0;

  for (const item of media) {
    if (item.type === "image") images += 1;
    if (item.type === "video") videos += 1;
  }

  return { images, videos };
}

export function formatFileSize(bytes: number): string {
  const gibibyte = 1024 * 1024 * 1024;
  const mebibyte = 1024 * 1024;

  if (bytes % gibibyte === 0) return `${bytes / gibibyte} GB`;
  if (bytes % mebibyte === 0) return `${bytes / mebibyte} MB`;
  return `${bytes.toLocaleString("en-US")} bytes`;
}

export function validateMediaSizes(
  platform: Platform,
  platformName: string,
  media: Media[],
  limits: MediaSizeLimits,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];

  for (const [index, item] of media.entries()) {
    if (item.size === undefined) continue;

    const configuredLimit = limits[item.type];
    const limit = typeof configuredLimit === "function" ? configuredLimit(item) : configuredLimit;
    if (limit === undefined || item.size <= limit) continue;

    errors.push({
      platform,
      severity: "error",
      code: `${item.type}_too_large`,
      message: `${platformName} ${item.type}s cannot exceed ${formatFileSize(limit)}.`,
      field: `media[${index}]`,
      limit,
      actual: item.size,
    });
  }

  return errors;
}
