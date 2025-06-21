import { Platform } from "../types/post";
import { XPublisher } from "./x";
import { Publisher } from "../types/publisher";

export const getPublisher = (platform: Platform): Publisher => {
  switch (platform) {
    case "x":
      return new XPublisher();
  }

  throw new Error(`Publisher for platform ${platform} not found`);
};
