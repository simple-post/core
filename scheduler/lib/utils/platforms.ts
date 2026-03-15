import type { Platform } from "@simple-post/sdk";

const PLATFORM_MAP: Record<string, Platform> = {
  x: "x",
  twitter: "x",
  youtube: "youtube",
  telegram: "telegram",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  bluesky: "bluesky",
  threads: "threads",
  linkedin: "linkedin",
  pinterest: "pinterest",
};

export function mapPlatformName(platform: string): Platform {
  return PLATFORM_MAP[platform.toLowerCase()] || (platform.toLowerCase() as Platform);
}
