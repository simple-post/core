import { deleteFromStorage, getKeyFromUrl } from "@simple-post/sdk";

import { mediaLogger, serializeError } from "@/lib/logger";
import type { AccountOptionsMap, MediaFile } from "@/types";

async function deleteStorageUrl(url: string, context: string): Promise<void> {
  const key = getKeyFromUrl(url);
  if (!key) {
    return;
  }

  try {
    await deleteFromStorage(key);
  } catch (error) {
    mediaLogger.error({ err: serializeError(error), key, context }, "Failed to delete file from storage");
  }
}

/**
 * Deletes a single media file and its thumbnail from S3-compatible storage
 * @param media - MediaFile to delete
 */
export async function deleteMediaFile(media: MediaFile): Promise<void> {
  // Delete main media file
  await deleteStorageUrl(media.url, "media");

  // Delete thumbnail if it exists
  if (media.thumbnailUrl) {
    await deleteStorageUrl(media.thumbnailUrl, "media-thumbnail");
  }
}

/**
 * Deletes multiple media files from S3-compatible storage
 * @param mediaFiles - Array of MediaFile objects to delete
 */
export async function deleteMediaFiles(mediaFiles: MediaFile[]): Promise<void> {
  await Promise.all(mediaFiles.map((media) => deleteMediaFile(media)));
}

function collectAccountOptionThumbnailUrls(accountOptions?: AccountOptionsMap | null): string[] {
  if (!accountOptions) {
    return [];
  }

  return Object.values(accountOptions)
    .map((value) => value?.thumbnailUrl)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

export async function deleteStorageUrls(urls: string[], context: string): Promise<void> {
  await Promise.all([...new Set(urls)].map((url) => deleteStorageUrl(url, context)));
}

export async function deleteAccountOptionFiles(accountOptions?: AccountOptionsMap | null): Promise<void> {
  await deleteStorageUrls(collectAccountOptionThumbnailUrls(accountOptions), "account-option-thumbnail");
}

export function getRemovedAccountOptionThumbnailUrls(
  previous?: AccountOptionsMap | null,
  next?: AccountOptionsMap | null,
): string[] {
  const nextUrls = new Set(collectAccountOptionThumbnailUrls(next));
  return collectAccountOptionThumbnailUrls(previous).filter((url) => !nextUrls.has(url));
}
