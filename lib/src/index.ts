import { getPublisher } from "./publishers";
import { Post } from "./types/post";

export const post = async (post: Post) => {
  for (const platform of post.platforms) {
    const publisher = getPublisher(platform);
    await publisher!.post(post.content);
  }
};
