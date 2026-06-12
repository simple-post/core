import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import axios, { type AxiosRequestConfig } from "axios";
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
 * Checks if a parsed IPv4 address (as four octets) is in a private/internal
 * range. Operating on numbers instead of the string representation closes
 * the decimal/octal/hex literal bypasses (e.g. http://2130706433/).
 */
const isPrivateIPv4 = (octets: number[]): boolean => {
  const [a, b] = octets;

  if (a === 127) return true; // Loopback (127.0.0.0/8)
  if (a === 10) return true; // Private Class A (10.0.0.0/8)
  if (a === 172 && b >= 16 && b <= 31) return true; // Private Class B (172.16.0.0/12)
  if (a === 192 && b === 168) return true; // Private Class C (192.168.0.0/16)
  if (a === 169 && b === 254) return true; // Link-local incl. cloud metadata (169.254.0.0/16)
  if (a === 0) return true; // Current network (0.0.0.0/8)
  if (a === 100 && b >= 64 && b <= 127) return true; // Shared address space (100.64.0.0/10)
  if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast (224.0.0.0/4), reserved (240.0.0.0/4), broadcast

  return false;
};

/**
 * Checks if an IP address literal is in a private/internal range.
 * Blocks: private networks, loopback, link-local, cloud metadata, etc.
 */
const isPrivateIP = (ip: string): boolean => {
  // Remove IPv6 brackets if present
  const cleanIP = ip.replace(/^\[/, "").replace(/\]$/, "");

  if (net.isIPv4(cleanIP)) {
    return isPrivateIPv4(cleanIP.split(".").map(Number));
  }

  if (net.isIPv6(cleanIP)) {
    const lower = cleanIP.toLowerCase();

    // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:hex) — validate the
    // embedded IPv4 address numerically.
    const mapped = /^::ffff:(.+)$/.exec(lower);
    if (mapped) {
      const tail = mapped[1];
      if (net.isIPv4(tail)) {
        return isPrivateIPv4(tail.split(".").map(Number));
      }
      // Hex-grouped form (::ffff:7f00:1)
      const groups = tail.split(":");
      if (groups.length === 2) {
        const value = (Number.parseInt(groups[0], 16) << 16) | Number.parseInt(groups[1], 16);
        return isPrivateIPv4([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
      }
    }

    const ipv6Patterns = [
      /^::1$/, // Loopback
      /^::$/, // Unspecified
      /^fe[89ab][0-9a-f]:/, // Link-local (fe80::/10)
      /^f[cd][0-9a-f]{2}:/, // Unique local (fc00::/7)
      /^ff[0-9a-f]{2}:/, // Multicast
    ];

    return ipv6Patterns.some((pattern) => pattern.test(lower));
  }

  return false;
};

// Hostnames pointing at cloud metadata / internal services.
// AWS, GCP, Azure, and other cloud providers use 169.254.169.254; some also
// use hostnames like metadata.google.internal.
const blockedHostPatterns = [/^metadata\./i, /\.internal$/i, /^internal\./i];

/**
 * Validates a URL string to prevent SSRF attacks. This is the synchronous
 * first line of defense (protocol, IP literals, blocked hostnames); names
 * that resolve to private addresses are caught at connection time by
 * ssrfSafeLookup below.
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

  // Block private/internal IP address literals
  if (isPrivateIP(hostname)) {
    throw new Error(`Access to private/internal IP addresses is not allowed: ${urlString}`);
  }

  for (const pattern of blockedHostPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`Access to internal/metadata endpoints is not allowed: ${urlString}`);
    }
  }
};

type SsrfSafeLookup = NonNullable<AxiosRequestConfig["lookup"]>;

/**
 * DNS lookup wrapper that rejects hostnames resolving to private/internal
 * addresses. Used as the `lookup` for outbound media requests so the check
 * applies to the address actually connected to — closing the
 * public-DNS-name-resolving-to-internal-IP bypass (and DNS rebinding, since
 * validation happens on the same resolution used for the connection).
 */
const ssrfSafeLookup: SsrfSafeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }

    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = resolved.find((address) => isLocalhost(address.address) || isPrivateIP(address.address));
    if (blocked) {
      callback(
        new Error(`Access to private/internal IP addresses is not allowed: ${hostname} -> ${blocked.address}`),
        [],
      );
      return;
    }

    callback(null, resolved as Parameters<typeof callback>[1]);
  });
};

// Maximum size of a downloaded media file. Matches the 500 MB upload limit
// enforced by the HTTP server and scheduler upload endpoints.
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

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
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: Infinity,
      maxRedirects: 5,
      // Validate the address actually connected to, not just the URL string.
      lookup: ssrfSafeLookup,
      // Each redirect hop is re-validated: a public URL must not be able to
      // bounce the request to localhost, a private address, or a metadata
      // endpoint. IP-literal hops would bypass DNS lookup entirely, so the
      // string-level check here is load-bearing.
      beforeRedirect: (options: Record<string, unknown>) => {
        const redirectUrl =
          typeof options.href === "string"
            ? options.href
            : `${String(options.protocol)}//${String(options.hostname)}${String(options.path ?? "")}`;
        validateUrlForSSRF(redirectUrl);
      },
    });

    const contentLength = Number(response.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      response.data.destroy();
      throw new Error(`Media at ${url} exceeds the maximum download size of ${MAX_DOWNLOAD_BYTES} bytes`);
    }

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

    // Write the stream to temp file, enforcing the size cap while streaming
    // (the content-length header is optional and can lie).
    const writer = fs.createWriteStream(tempFilePath);
    let receivedBytes = 0;
    const sizeLimiter = new Transform({
      transform(chunk: Buffer, _encoding, transformCallback) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_DOWNLOAD_BYTES) {
          transformCallback(
            new Error(`Media at ${url} exceeds the maximum download size of ${MAX_DOWNLOAD_BYTES} bytes`),
          );
          return;
        }
        transformCallback(null, chunk);
      },
    });

    try {
      await pipeline(response.data, sizeLimiter, writer);
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
