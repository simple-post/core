import { Content } from "./post";

export interface Publisher {
  post: (post: Content | Content[]) => Promise<void>;
}
