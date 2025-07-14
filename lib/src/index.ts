import { getPublisher } from "./publishers";
import { getCredentialsFromEnv, mergeOptions } from "./utils/credentials";

import type { PostResult } from "./types";
import type { Platform, Post } from "./types/post";

export async function post(post: Post): Promise<Map<Platform, PostResult>> {
  const results = new Map<Platform, PostResult>();
  const envCredentials = getCredentialsFromEnv();
  const mergedOptions = mergeOptions(envCredentials, post.options);

  for (const platform of post.platforms) {
    const publisher = getPublisher(platform, mergedOptions);
    results.set(platform, await publisher.post(post.content, mergedOptions));
  }

  return results;
}
