import { getPublisher } from "./publishers";
import { PostResult } from "./types";
import { Platform, Post } from "./types/post";

export async function post(post: Post): Promise<Map<Platform, PostResult>> {
  const results = new Map<Platform, PostResult>();

  for (const platform of post.platforms) {
    const publisher = getPublisher(platform);
    results.set(platform, await publisher.post(post.content, post.options));
  }

  return results;
}
