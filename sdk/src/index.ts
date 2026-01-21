import { getPublisher } from "./publishers";
import { getCredentialsFromEnv, mergeOptions } from "./utils/credentials";
import { MediaResolver } from "./utils/media-resolver";

import type { PostResult } from "./types";
import type { Content, Platform, Post } from "./types/post";

export interface PreparedPost {
  post: Post;
  cleanup: () => Promise<void>;
}

/**
 * Pre-resolves media for multi-platform posting.
 * Downloads URLs to files or uploads files to URLs as needed based on platform requirements.
 * Uses promise-based caching to avoid duplicate operations.
 *
 * @param post - The post content with platforms and media
 * @returns Prepared post with resolved media and cleanup function
 *
 * @example
 * ```typescript
 * const { post: prepared, cleanup } = await prepareMedia({
 *   platforms: ["youtube", "x", "facebook"],
 *   content: { media: [{ type: "video", url: "https://..." }] }
 * });
 *
 * try {
 *   await post(prepared);
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function prepareMedia(post: Post): Promise<PreparedPost> {
  const resolver = new MediaResolver();

  try {
    // Resolve media based on platform requirements
    const resolvedMedia = post.content.media
      ? await resolver.resolve(post.content.media, post.platforms)
      : undefined;

    // Build resolved content
    const resolvedContent: Content = {
      text: post.content.text,
      media: resolvedMedia,
    };

    // Build resolved post
    const resolvedPost: Post = {
      content: resolvedContent,
      platforms: post.platforms,
      options: post.options,
    };

    return {
      post: resolvedPost,
      cleanup: async () => {
        await resolver.cleanup();
      },
    };
  } catch (error) {
    // Cleanup on error
    await resolver.cleanup();
    throw error;
  }
}

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
