import { Platform, PostOptions } from "../types/post";
import { XPublisher } from "./x";
import { Publisher } from "./base";
import { YouTubePublisher } from "./youtube";
import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";
import { TelegramPublisher } from "./telegram";

export const getPublisher = (platform: Platform, options?: PostOptions): Publisher => {
  switch (platform) {
    case "x":
      return new XPublisher(options);
    case "youtube":
      return new YouTubePublisher(options);
    case "facebook":
      return new FacebookPublisher(options);
    case "instagram":
      return new InstagramPublisher(options);
    case "telegram":
      return new TelegramPublisher(options);
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
