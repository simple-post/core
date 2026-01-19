import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import axios from "axios";
import { v7 as uuidv7 } from "uuid";

import type { Media, Video } from "../types/post";
import type { Readable } from "node:stream";

/**
 * Checks if a media source is a URL
 */
export const isUrl = (source: string): boolean => {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Gets the media source (path or url) from a media object
 */
export const getMediaSource = (media: Media): string | undefined => {
  return media.path || media.url;
};

/**
 * Checks if media has a valid source (either path or url)
 */
export const hasValidSource = (media: Media): boolean => {
  return Boolean(media.path || media.url);
};

/**
 * Gets the file extension from a URL or path
 */
const getExtensionFromSource = (source: string): string => {
  try {
    const url = new URL(source);
    const pathname = url.pathname;
    const ext = path.extname(pathname);
    return ext || "";
  } catch {
    return path.extname(source);
  }
};

/**
 * Downloads a file from a URL to a temporary local file
 * Returns the path to the downloaded file
 */
export const downloadToTempFile = async (url: string, preferredExtension?: string): Promise<string> => {
  const response = await axios.get<Readable>(url, {
    responseType: "stream",
    timeout: 120_000, // 2 minutes timeout for large files
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // Determine file extension
  let extension = preferredExtension || getExtensionFromSource(url);

  // Try to get extension from content-type if not available
  if (!extension) {
    const contentType = response.headers["content-type"] as string;
    if (contentType) {
      const mimeToExt: Record<string, string> = {
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
      };
      extension = mimeToExt[contentType.split(";")[0]] || "";
    }
  }

  // Create temp file path
  const tempDir = os.tmpdir();
  const tempFilename = `simplepost_${uuidv7()}${extension}`;
  const tempFilePath = path.join(tempDir, tempFilename);

  // Write the stream to temp file
  const writer = fs.createWriteStream(tempFilePath);
  await pipeline(response.data, writer);

  return tempFilePath;
};

/**
 * Resolves a media item to a local file path.
 * If the media has a path, returns it directly.
 * If the media has a url, downloads it to a temp file and returns the path.
 * Returns the path and a cleanup function to delete the temp file if one was created.
 */
export const resolveMediaPath = async (
  media: Media,
): Promise<{ path: string; cleanup: () => Promise<void>; isTemp: boolean }> => {
  if (media.path) {
    return { path: media.path, cleanup: async () => {}, isTemp: false };
  }

  if (media.url) {
    const tempPath = await downloadToTempFile(media.url);
    return {
      path: tempPath,
      cleanup: async () => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // Ignore cleanup errors
        }
      },
      isTemp: true,
    };
  }

  throw new Error("Media must have either a path or url");
};

/**
 * Resolves a video's thumbnail to a local file path.
 * Similar to resolveMediaPath but for video thumbnails.
 */
export const resolveThumbnailPath = async (
  video: Video,
): Promise<{ path: string | undefined; cleanup: () => Promise<void>; isTemp: boolean }> => {
  if (video.thumbnailPath) {
    return { path: video.thumbnailPath, cleanup: async () => {}, isTemp: false };
  }

  if (video.thumbnailUrl) {
    const tempPath = await downloadToTempFile(video.thumbnailUrl);
    return {
      path: tempPath,
      cleanup: async () => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // Ignore cleanup errors
        }
      },
      isTemp: true,
    };
  }

  return { path: undefined, cleanup: async () => {}, isTemp: false };
};

/**
 * Helper class to manage multiple temp files and clean them up together
 */
export class TempFileManager {
  private cleanupFunctions: (() => Promise<void>)[] = [];

  add(cleanup: () => Promise<void>): void {
    this.cleanupFunctions.push(cleanup);
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.cleanupFunctions.map((fn) => fn()));
    this.cleanupFunctions = [];
  }
}

/**
 * Resolves a media item to a public URL.
 * If the media has a url, returns it directly.
 * If the media has a path, uploads it using the provided upload function.
 * Returns the URL and an optional cleanup key for the uploaded file.
 */
export const resolveMediaUrl = async (
  media: Media,
  uploadFile: (filePath: string, key: string) => Promise<string>,
): Promise<{ url: string; uploadedKey?: string }> => {
  if (media.url) {
    return { url: media.url };
  }

  if (media.path) {
    const key = `${uuidv7()}_${path.basename(media.path)}`;
    const url = await uploadFile(media.path, key);
    return { url, uploadedKey: key };
  }

  throw new Error("Media must have either a path or url");
};
