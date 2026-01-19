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
 * Safely removes a temp file, ignoring errors
 */
const cleanupTempFile = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
};

/**
 * Checks if a hostname is localhost
 */
const isLocalhost = (hostname: string): boolean => {
  const lowercaseHostname = hostname.toLowerCase();
  return (
    lowercaseHostname === "localhost" ||
    lowercaseHostname === "127.0.0.1" ||
    lowercaseHostname === "::1" ||
    lowercaseHostname === "[::1]" ||
    lowercaseHostname === "0.0.0.0"
  );
};

/**
 * Checks if an IP address is in a private/internal range
 * Blocks: private networks, loopback, link-local, cloud metadata, etc.
 */
const isPrivateIP = (ip: string): boolean => {
  // Remove IPv6 brackets if present
  const cleanIP = ip.replaceAll(/^\[|\]$/g, "");

  // IPv4 patterns
  const ipv4Patterns = [
    /^127\./, // Loopback (127.0.0.0/8)
    /^10\./, // Private Class A (10.0.0.0/8)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B (172.16.0.0/12)
    /^192\.168\./, // Private Class C (192.168.0.0/16)
    /^169\.254\./, // Link-local (169.254.0.0/16) - includes cloud metadata
    /^0\./, // Current network (0.0.0.0/8)
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Shared address space (100.64.0.0/10)
    /^192\.0\.0\./, // IETF Protocol Assignments (192.0.0.0/24)
    /^192\.0\.2\./, // TEST-NET-1 (192.0.2.0/24)
    /^198\.51\.100\./, // TEST-NET-2 (198.51.100.0/24)
    /^203\.0\.113\./, // TEST-NET-3 (203.0.113.0/24)
    /^224\./, // Multicast (224.0.0.0/4)
    /^240\./, // Reserved (240.0.0.0/4)
    /^255\.255\.255\.255$/, // Broadcast
  ];

  for (const pattern of ipv4Patterns) {
    if (pattern.test(cleanIP)) {
      return true;
    }
  }

  // IPv6 patterns
  const ipv6Patterns = [
    /^::1$/, // Loopback
    /^::$/, // Unspecified
    /^fe80:/i, // Link-local
    /^fc00:/i, // Unique local (fc00::/7)
    /^fd[0-9a-f]{2}:/i, // Unique local (fd00::/8)
    /^ff[0-9a-f]{2}:/i, // Multicast
    /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.)/i, // IPv4-mapped IPv6
  ];

  for (const pattern of ipv6Patterns) {
    if (pattern.test(cleanIP)) {
      return true;
    }
  }

  return false;
};

/**
 * Validates a URL to prevent SSRF attacks
 * Throws an error if the URL points to a private/internal resource
 */
const validateUrlForSSRF = (urlString: string): void => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  // Only allow http and https protocols
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Invalid URL protocol: ${parsedUrl.protocol}. Only http and https are allowed.`);
  }

  const hostname = parsedUrl.hostname;

  // Block localhost
  if (isLocalhost(hostname)) {
    throw new Error(`Access to localhost URLs is not allowed: ${urlString}`);
  }

  // Block private/internal IP addresses
  if (isPrivateIP(hostname)) {
    throw new Error(`Access to private/internal IP addresses is not allowed: ${urlString}`);
  }

  // Block specific cloud metadata endpoints by hostname pattern
  // AWS, GCP, Azure, and other cloud providers use 169.254.169.254
  // Some also use hostnames like metadata.google.internal
  const blockedHostPatterns = [/^metadata\./i, /\.internal$/i, /^internal\./i];

  for (const pattern of blockedHostPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`Access to internal/metadata endpoints is not allowed: ${urlString}`);
    }
  }
};

/**
 * Downloads a file from a URL to a temporary local file
 * Returns the path to the downloaded file
 */
export const downloadToTempFile = async (url: string, preferredExtension?: string): Promise<string> => {
  // Validate URL to prevent SSRF attacks
  validateUrlForSSRF(url);

  // Determine file extension early from URL
  const extension = preferredExtension || getExtensionFromSource(url);

  // Create temp file path before making the request
  const tempDir = os.tmpdir();
  const tempFilename = `simplepost_${uuidv7()}${extension || ".tmp"}`;
  let tempFilePath = path.join(tempDir, tempFilename);

  try {
    const response = await axios.get<Readable>(url, {
      responseType: "stream",
      timeout: 120_000, // 2 minutes timeout for large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

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
        const detectedExt = mimeToExt[contentType.split(";")[0]];
        if (detectedExt) {
          // Update the temp file path with the correct extension
          const newTempFilePath = tempFilePath.replace(/\.tmp$/, detectedExt);
          if (newTempFilePath !== tempFilePath) {
            tempFilePath = newTempFilePath;
          }
        }
      }
    }

    // Write the stream to temp file
    const writer = fs.createWriteStream(tempFilePath);

    try {
      await pipeline(response.data, writer);
    } catch (pipelineError) {
      // Clean up partially written file on pipeline failure
      cleanupTempFile(tempFilePath);
      throw pipelineError;
    }

    return tempFilePath;
  } catch (error) {
    // Clean up temp file if it was created before the error
    cleanupTempFile(tempFilePath);
    throw error;
  }
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
