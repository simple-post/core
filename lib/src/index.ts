import { getPublisher } from "./publishers";
import { Platform, PostMulti, Post } from "./types/post";

export async function post(post: Post): Promise<Map<Platform, string>>;
export async function post(post: PostMulti): Promise<Map<Platform, string[]>>;
export async function post(post: Post | PostMulti): Promise<Map<Platform, string | string[]>> {
  if (Array.isArray(post.content)) {
    const results = new Map<Platform, string[]>();

    for (const platform of post.platforms) {
      const publisher = getPublisher(platform);
      results.set(platform, await publisher.post(post.content));
    }

    return results;
  } else {
    const results = new Map<Platform, string>();

    for (const platform of post.platforms) {
      const publisher = getPublisher(platform);
      const platformResult = await publisher.post([post.content]);
      results.set(platform, platformResult[0]);
    }

    return results;
  }
}
