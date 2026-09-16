import { getOwnedStorageKeyFromUrl } from "@simple-post/sdk";

import { McpToolError } from "@/lib/mcp/tool-errors";
import { uploadMedia } from "@/lib/mcp/tools/media";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile, ThreadSegment } from "@/types";

type UploadedMedia = Awaited<ReturnType<typeof uploadMedia>>;
type UploadCache = Map<string, Promise<UploadedMedia>>;

function filenameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").findLast(Boolean) ?? "media");
  } catch {
    return "media";
  }
}

async function ingestUrl(
  userId: string,
  url: string,
  cache: UploadCache,
  options: { filename?: string; mimeType?: string } = {},
): Promise<UploadedMedia | undefined> {
  if (getOwnedStorageKeyFromUrl(url, userId)) return undefined;

  let pending = cache.get(url);
  if (!pending) {
    pending = uploadMedia(userId, {
      url,
      filename: options.filename ?? filenameFromUrl(url),
      mimeType: options.mimeType,
    });
    cache.set(url, pending);
  }
  return pending;
}

async function ingestMediaFile(userId: string, media: MediaFile, cache: UploadCache): Promise<MediaFile> {
  const imported = await ingestUrl(userId, media.url, cache, {
    filename: media.filename,
    mimeType: media.contentType,
  });
  if (imported && imported.type !== media.type) {
    throw new McpToolError({
      code: "MEDIA_TYPE_MISMATCH",
      stage: "media_validation",
      recovery: "replace_media",
      maxAutomaticRetries: 0,
      message: `${media.filename || "Media"} was declared as ${media.type}, but its bytes are ${imported.type}.`,
    });
  }

  let thumbnailUrl = media.thumbnailUrl;
  if (thumbnailUrl) {
    const thumbnail = await ingestUrl(userId, thumbnailUrl, cache);
    if (thumbnail && thumbnail.type !== "image") {
      throw new McpToolError({
        code: "MEDIA_THUMBNAIL_NOT_IMAGE",
        stage: "media_validation",
        recovery: "replace_media",
        maxAutomaticRetries: 0,
        message: "A video thumbnail must be an image.",
      });
    }
    thumbnailUrl = thumbnail?.url ?? thumbnailUrl;
  }

  return {
    ...media,
    url: imported?.url ?? media.url,
    filename: imported?.filename ?? media.filename,
    size: imported?.size ?? media.size,
    contentType: imported?.mimeType ?? media.contentType,
    thumbnailUrl,
  };
}

async function ingestMediaList(
  userId: string,
  media: MediaFile[] | undefined,
  cache: UploadCache,
): Promise<MediaFile[] | undefined> {
  return media ? Promise.all(media.map((item) => ingestMediaFile(userId, item, cache))) : undefined;
}

async function ingestThread(
  userId: string,
  thread: ThreadSegment[] | undefined,
  cache: UploadCache,
): Promise<ThreadSegment[] | undefined> {
  return thread
    ? Promise.all(
        thread.map(async (segment) => ({
          ...segment,
          media: await ingestMediaList(userId, segment.media, cache),
        })),
      )
    : undefined;
}

/**
 * Imports every external media URL in a post into user-owned storage once.
 * The returned values are safe to persist and later publish from any surface.
 */
export async function ingestPostMedia<
  T extends {
    media?: MediaFile[];
    thread?: ThreadSegment[];
    accountOverrides?: AccountOverridesMap;
    accountOptions?: AccountOptionsMap;
  },
>(userId: string, input: T): Promise<T> {
  const cache: UploadCache = new Map();
  const accountOverrides = input.accountOverrides
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.accountOverrides).map(async ([accountId, override]) => [
            accountId,
            {
              ...override,
              media: await ingestMediaList(userId, override.media, cache),
              thread: await ingestThread(userId, override.thread, cache),
            },
          ]),
        ),
      )
    : undefined;

  const accountOptions = input.accountOptions
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.accountOptions).map(async ([accountId, options]) => {
            if (!options || typeof options.thumbnailUrl !== "string") return [accountId, options];
            const thumbnail = await ingestUrl(userId, options.thumbnailUrl, cache);
            if (thumbnail && thumbnail.type !== "image") {
              throw new McpToolError({
                code: "MEDIA_THUMBNAIL_NOT_IMAGE",
                stage: "media_validation",
                recovery: "replace_media",
                maxAutomaticRetries: 0,
                message: "A video thumbnail must be an image.",
              });
            }
            return [accountId, { ...options, thumbnailUrl: thumbnail?.url ?? options.thumbnailUrl }];
          }),
        ),
      )
    : undefined;

  return {
    ...input,
    media: await ingestMediaList(userId, input.media, cache),
    thread: await ingestThread(userId, input.thread, cache),
    accountOverrides,
    accountOptions,
  };
}
