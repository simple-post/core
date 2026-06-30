import type { Media } from "../types/post";

export function hasMediaSource(media: Media): boolean {
  return Boolean(media.path || media.url);
}

export function countMedia(media: Media[]): { images: number; videos: number } {
  let images = 0;
  let videos = 0;

  for (const item of media) {
    if (item.type === "image") images += 1;
    if (item.type === "video") videos += 1;
  }

  return { images, videos };
}
