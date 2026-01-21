import { FacebookPublisher } from "../publishers/facebook";
import { InstagramPublisher } from "../publishers/instagram";
import { TelegramPublisher } from "../publishers/telegram";
import { TikTokPublisher } from "../publishers/tiktok";
import { XPublisher } from "../publishers/x";
import { YouTubePublisher } from "../publishers/youtube";
import type { MediaRequirement } from "../publishers/base";

import type { Platform } from "../types/post";

/**
 * Gets the media requirement for a platform by reading it from the publisher class
 * @param platform - The platform to check
 * @returns The media requirement for the platform
 */
export function getPlatformMediaRequirement(platform: Platform): MediaRequirement {
  switch (platform) {
    case "youtube":
      return YouTubePublisher.mediaRequirement;
    case "x":
      return XPublisher.mediaRequirement;
    case "facebook":
      return FacebookPublisher.mediaRequirement;
    case "tiktok":
      return TikTokPublisher.mediaRequirement;
    case "instagram":
      return InstagramPublisher.mediaRequirement;
    case "telegram":
      return TelegramPublisher.mediaRequirement;
    case "linkedin":
      // TODO: Implement when LinkedIn publisher is added
      return "path";
    case "pinterest":
      // TODO: Implement when Pinterest publisher is added
      return "path";
  }
}

/**
 * Gets the media requirements for a set of platforms
 * @param platforms - Array of platforms to check
 * @returns Object indicating if any platform needs path, url, or both
 */
export function getPlatformRequirements(platforms: Platform[]): {
  needsPath: boolean;
  needsUrl: boolean;
  needsEither: boolean;
} {
  let needsPath = false;
  let needsUrl = false;
  let needsEither = false;

  for (const platform of platforms) {
    const requirement = getPlatformMediaRequirement(platform);
    if (requirement === "path") {
      needsPath = true;
    } else if (requirement === "url") {
      needsUrl = true;
    } else if (requirement === "either") {
      needsEither = true;
    }
  }

  return { needsPath, needsUrl, needsEither };
}

// Re-export MediaRequirement type for convenience
export type { MediaRequirement } from "../publishers/base";
