import { BlueskyPublisher } from "../publishers/bluesky";
import { FacebookPublisher } from "../publishers/facebook";
import { ForemPublisher } from "../publishers/forem";
import { InstagramPublisher } from "../publishers/instagram";
import { LinkedInPublisher } from "../publishers/linkedin";
import { NostrPublisher } from "../publishers/nostr";
import { PinterestPublisher } from "../publishers/pinterest";
import { TelegramPublisher } from "../publishers/telegram";
import { ThreadsPublisher } from "../publishers/threads";
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
    case "youtube": {
      return YouTubePublisher.mediaRequirement;
    }
    case "x": {
      return XPublisher.mediaRequirement;
    }
    case "facebook": {
      return FacebookPublisher.mediaRequirement;
    }
    case "tiktok": {
      return TikTokPublisher.mediaRequirement;
    }
    case "instagram": {
      return InstagramPublisher.mediaRequirement;
    }
    case "telegram": {
      return TelegramPublisher.mediaRequirement;
    }
    case "linkedin": {
      return LinkedInPublisher.mediaRequirement;
    }
    case "pinterest": {
      return PinterestPublisher.mediaRequirement;
    }
    case "bluesky": {
      return BlueskyPublisher.mediaRequirement;
    }
    case "threads": {
      return ThreadsPublisher.mediaRequirement;
    }
    case "forem": {
      return ForemPublisher.mediaRequirement;
    }
    case "nostr": {
      return NostrPublisher.mediaRequirement;
    }
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
    switch (requirement) {
      case "path": {
        needsPath = true;

        break;
      }
      case "url": {
        needsUrl = true;

        break;
      }
      case "either": {
        needsEither = true;

        break;
      }
      // No default
    }
  }

  return { needsPath, needsUrl, needsEither };
}

// Re-export MediaRequirement type for convenience
export type { MediaRequirement } from "../publishers/base";
