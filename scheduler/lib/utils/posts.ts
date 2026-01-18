import type { SocialPost } from "@/types";

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

export function hydratePost(raw: SocialPost) {
  return {
    ...raw,
    scheduledFor: toDate(raw.scheduledFor),
    createdAt: toDate(raw.createdAt),
    publishedAt: raw.publishedAt ? toDate(raw.publishedAt) : undefined,
  };
}

export function hydratePosts(rawPosts: SocialPost[]) {
  return rawPosts.map(hydratePost);
}
