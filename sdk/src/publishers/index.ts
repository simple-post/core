import { BlueskyPublisher } from "./bluesky";
import { FacebookPublisher } from "./facebook";
import { ForemPublisher } from "./forem";
import { GoogleBusinessProfilePublisher } from "./google-business-profile";
import { InstagramPublisher } from "./instagram";
import { LinkedInPublisher } from "./linkedin";
import { PinterestPublisher } from "./pinterest";
import { TelegramPublisher } from "./telegram";
import { ThreadsPublisher } from "./threads";
import { TikTokPublisher } from "./tiktok";
import { XPublisher } from "./x";
import { YouTubePublisher } from "./youtube";

import type { Publisher } from "./base";
import type { Platform, PostOptionsWithCredentials } from "../types/post";

export const getPublisher = (platform: Platform, options?: PostOptionsWithCredentials): Publisher => {
  switch (platform) {
    case "x": {
      return new XPublisher(options);
    }
    case "youtube": {
      return new YouTubePublisher(options);
    }
    case "facebook": {
      return new FacebookPublisher(options);
    }
    case "instagram": {
      return new InstagramPublisher(options);
    }
    case "telegram": {
      return new TelegramPublisher(options);
    }
    case "tiktok": {
      return new TikTokPublisher(options);
    }
    case "bluesky": {
      return new BlueskyPublisher(options);
    }
    case "threads": {
      return new ThreadsPublisher(options);
    }
    case "linkedin": {
      return new LinkedInPublisher(options);
    }
    case "pinterest": {
      return new PinterestPublisher(options);
    }
    case "forem": {
      return new ForemPublisher(options);
    }
    case "google_business_profile": {
      return new GoogleBusinessProfilePublisher(options);
    }
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
