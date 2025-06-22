import { Platform } from "../types/post";
import { XPublisher } from "./x";
import { Publisher } from "../types/publisher";
import { YouTubePublisher } from "./youtube";

export const getPublisher = (platform: Platform): Publisher => {
  switch (platform) {
    case "x":
      return new XPublisher();
    case "youtube":
      return new YouTubePublisher();
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
