import { Content } from "./post";

export interface Publisher {
  post: (post: Content) => Promise<void>;
}
