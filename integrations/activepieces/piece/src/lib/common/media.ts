import { randomUUID } from 'node:crypto';

export type MediaType = 'image' | 'video';

export type SimplePostMediaFile = {
  id: string;
  url: string;
  type: MediaType;
  filename: string;
  size: number;
  contentType?: string;
};

// Mirrors the formats the Scheduler API accepts.
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm']);

export function filenameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : 'media';
  } catch {
    return 'media';
  }
}

export function mediaTypeFromFilename(filename: string): MediaType | undefined {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return undefined;
}

export function mediaTypeFromContentType(contentType: string | undefined): MediaType | undefined {
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  return undefined;
}

type MediaInput = { url?: unknown; type?: unknown };

// The Scheduler API takes full media descriptors. SimplePost imports external
// URLs into its own storage and replaces the filename and size with the real
// values, so a URL plus its media type is enough here.
export function toMediaFiles(items: unknown[] | undefined): SimplePostMediaFile[] | undefined {
  if (!items || items.length === 0) return undefined;

  return items.map((item, index) => {
    const input = (typeof item === 'string' ? { url: item } : (item ?? {})) as MediaInput;
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!url) {
      throw new Error(`Media item ${index + 1} needs a file URL.`);
    }

    const filename = filenameFromUrl(url);
    const type =
      input.type === 'image' || input.type === 'video' ? input.type : mediaTypeFromFilename(filename);
    if (!type) {
      throw new Error(
        `Could not tell whether media item ${index + 1} (${filename}) is an image or a video. Set its Type.`,
      );
    }

    return { id: randomUUID(), url, type, filename, size: 0 };
  });
}

export function toThread(items: unknown[] | undefined): { message: string }[] | undefined {
  const segments = (items ?? [])
    .map((item) => (typeof item === 'string' ? item : item == null ? '' : String(item)))
    .filter((message) => message.trim().length > 0)
    .map((message) => ({ message }));
  return segments.length > 0 ? segments : undefined;
}
