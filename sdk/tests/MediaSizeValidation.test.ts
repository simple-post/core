import { validateContentForPlatform } from "../src/validation";

import type { Media, Platform } from "../src/types/post";

interface SizeCase {
  name: string;
  platform: Platform;
  media: Media;
  limit: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const cases: SizeCase[] = [
  { name: "X image", platform: "x", media: { type: "image", url: "https://example.com/image.jpg" }, limit: 5 * MB },
  { name: "X GIF", platform: "x", media: { type: "image", url: "https://example.com/animation.gif" }, limit: 15 * MB },
  { name: "X video", platform: "x", media: { type: "video", url: "https://example.com/video.mp4" }, limit: 512 * MB },
  {
    name: "YouTube video",
    platform: "youtube",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 256 * GB,
  },
  {
    name: "Telegram URL photo",
    platform: "telegram",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 5 * MB,
  },
  {
    name: "Telegram URL video",
    platform: "telegram",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 20 * MB,
  },
  { name: "Telegram upload photo", platform: "telegram", media: { type: "image", path: "image.jpg" }, limit: 10 * MB },
  { name: "Telegram upload video", platform: "telegram", media: { type: "video", path: "video.mp4" }, limit: 50 * MB },
  {
    name: "Facebook image",
    platform: "facebook",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 4 * MB,
  },
  {
    name: "Facebook video",
    platform: "facebook",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 4 * GB,
  },
  {
    name: "Instagram image",
    platform: "instagram",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 8 * MB,
  },
  {
    name: "Instagram video",
    platform: "instagram",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 300 * MB,
  },
  {
    name: "TikTok image",
    platform: "tiktok",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 20 * MB,
  },
  {
    name: "TikTok video",
    platform: "tiktok",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 4 * GB,
  },
  {
    name: "Bluesky image",
    platform: "bluesky",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 2_000_000,
  },
  {
    name: "Threads image",
    platform: "threads",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 8 * MB,
  },
  {
    name: "Threads video",
    platform: "threads",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 1 * GB,
  },
  {
    name: "LinkedIn single-upload video",
    platform: "linkedin",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 200 * MB,
  },
  {
    name: "Pinterest image",
    platform: "pinterest",
    media: { type: "image", url: "https://example.com/image.jpg" },
    limit: 20 * MB,
  },
  {
    name: "Pinterest video",
    platform: "pinterest",
    media: { type: "video", url: "https://example.com/video.mp4" },
    limit: 2 * GB,
  },
];

describe("platform media-size validation", () => {
  it.each(cases)("accepts $name at its exact limit", ({ platform, media, limit }) => {
    const result = validateContentForPlatform(platform, {
      text: "Media size boundary",
      media: [{ ...media, size: limit }],
    });

    expect(result.errors.filter((issue) => issue.code.endsWith("_too_large"))).toHaveLength(0);
  });

  it.each(cases)("rejects $name one byte over its limit", ({ platform, media, limit }) => {
    const result = validateContentForPlatform(platform, {
      text: "Oversized media",
      media: [{ ...media, size: limit + 1 }],
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: `${media.type}_too_large`,
        field: "media[0]",
        limit,
        actual: limit + 1,
      }),
    );
    expect(result.isValid).toBe(false);
  });
});
