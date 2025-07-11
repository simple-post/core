import { Platform } from "../types/post";
import { XPublisher } from "./x";
import { Publisher } from "./base";
import { YouTubePublisher } from "./youtube";
import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";
import { TelegramPublisher } from "./telegram";

export const getPublisher = (platform: Platform): Publisher => {
  switch (platform) {
    case "x":
      return new XPublisher();
    case "youtube":
      return new YouTubePublisher();
    case "facebook":
      return new FacebookPublisher();
    case "instagram":
      return new InstagramPublisher();
    case "telegram":
      return new TelegramPublisher();
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
