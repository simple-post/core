import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";
import { TelegramPublisher } from "./telegram";
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
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
