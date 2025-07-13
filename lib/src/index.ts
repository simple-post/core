import { getPublisher } from "./publishers";

import type { PostResult } from "./types";
import type { Platform, Post } from "./types/post";

export async function post(post: Post): Promise<Map<Platform, PostResult>> {
  const results = new Map<Platform, PostResult>();

  for (const platform of post.platforms) {
    const publisher = getPublisher(platform, post.options);
    results.set(platform, await publisher.post(post.content, post.options));
  }

  return results;
}
