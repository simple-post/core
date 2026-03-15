import { deleteFromStorage, getKeyFromUrl } from "@simple-post/sdk";

import { mediaLogger, serializeError } from "@/lib/logger";
import type { MediaFile } from "@/types";

/**
 * Deletes a single media file and its thumbnail from S3-compatible storage
 * @param media - MediaFile to delete
 */
export async function deleteMediaFile(media: MediaFile): Promise<void> {
  // Delete main media file
  const key = getKeyFromUrl(media.url);
  if (key) {
    try {
      await deleteFromStorage(key);
    } catch (error) {
      mediaLogger.error({ err: serializeError(error), key }, "Failed to delete media from storage");
      // Don't throw - continue with thumbnail deletion
    }
  }

  // Delete thumbnail if it exists
  if (media.thumbnailUrl) {
    const thumbnailKey = getKeyFromUrl(media.thumbnailUrl);
    if (thumbnailKey) {
      try {
        await deleteFromStorage(thumbnailKey);
      } catch (error) {
        mediaLogger.error({ err: serializeError(error), thumbnailKey }, "Failed to delete thumbnail from storage");
        // Don't throw - cleanup is best effort
      }
    }
  }
}

/**
 * Deletes multiple media files from S3-compatible storage
 * @param mediaFiles - Array of MediaFile objects to delete
 */
export async function deleteMediaFiles(mediaFiles: MediaFile[]): Promise<void> {
  await Promise.all(mediaFiles.map((media) => deleteMediaFile(media)));
}
