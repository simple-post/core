import { getPublisher } from "./publishers";
import { PostResult } from "./types";
import { Platform, PostMulti, Post } from "./types/post";

export async function post(post: Post): Promise<Map<Platform, PostResult>>;
export async function post(post: PostMulti): Promise<Map<Platform, PostResult[]>>;
export async function post(post: Post | PostMulti): Promise<Map<Platform, PostResult | PostResult[]>> {
  if (Array.isArray(post.content)) {
    const results = new Map<Platform, PostResult[]>();

    for (const platform of post.platforms) {
      const publisher = getPublisher(platform);
      results.set(platform, await publisher.post(post.content));
    }

    return results;
  } else {
    const results = new Map<Platform, PostResult>();

    for (const platform of post.platforms) {
      const publisher = getPublisher(platform);
      const platformResult = await publisher.post([post.content]);
      results.set(platform, platformResult[0]);
    }

    return results;
  }
}
