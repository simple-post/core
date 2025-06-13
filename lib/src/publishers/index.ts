import { Platform } from "../types/post";
import { XPublisher } from "./X";

export const getPublisher = (platform: Platform) => {
  switch (platform) {
    case "x":
      return new XPublisher();
  }
};
