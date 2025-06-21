import { Content } from "./post";

export abstract class Publisher {
  abstract post(posts: Content[]): Promise<string[]>;
}
