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

// Export all types for TypeScript and JavaScript users
export type {
  Platform,
  Post,
  Content,
  Media,
  Image,
  Video,
  PostOptions,
  CommonOptions,
  XOptions,
  TelegramOptions,
  YouTubeOptions,
  FacebookOptions,
  InstagramOptions,
  TikTokOptions,
  LogLevel,
} from "./types/post";

export type { PostResult } from "./types";
export { PostError, PostErrorType } from "./types";

// Export schemas for runtime validation
export {
  PlatformSchema,
  PostSchema,
  ContentSchema,
  MediaSchema,
  ImageSchema,
  VideoSchema,
  PostOptionsSchema,
  CommonOptionsSchema,
  XOptionsSchema,
  TelegramOptionsSchema,
  YouTubeOptionsSchema,
  FacebookOptionsSchema,
  InstagramOptionsSchema,
  TikTokOptionsSchema,
} from "./types/post";
