import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import axios from "axios";
import sharp from "sharp";

import { remoteRequestConfig, validateUrlForSSRF } from "./media";

import { ALLOWED_MEDIA_TYPES, mediaHeaderMatchesContentType, normalizeContentType } from "../media-types";

import type { Readable } from "node:stream";

// Bound both network traffic and decoder work. Videos are only sniffed; images
// are decoded so a valid-looking signature on a truncated file cannot pass.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const VIDEO_PREFIX_BYTES = 4096;

export interface MediaInspection {
  size: number;
  contentType: string;
  width?: number;
  height?: number;
}

export class MediaInspectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaInspectionError";
  }
}

const invalidMedia = () =>
  new MediaInspectionError(
    "media_invalid",
    "This URL or file does not contain a supported image or video. Upload the file directly; links to sign-in, preview, or download-confirmation pages cannot be published.",
  );

function detectContentType(bytes: Buffer): string | undefined {
  // QuickTime and MP4 share ftyp; the major brand disambiguates them.
  if (bytes.subarray(4, 8).toString() === "ftyp" && bytes.subarray(8, 12).toString() === "qt  ") {
    return "video/quicktime";
  }
  return [...ALLOWED_MEDIA_TYPES].find((type) => mediaHeaderMatchesContentType(bytes, type));
}

async function inspectStream(stream: Readable, size?: number, reportedType?: string): Promise<MediaInspection> {
  const chunks: Buffer[] = [];
  let length = 0;
  let contentType: string | undefined;
  try {
    if (reportedType && !ALLOWED_MEDIA_TYPES.has(reportedType) && reportedType !== "application/octet-stream") {
      throw invalidMedia();
    }
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      length += chunk.length;
      chunks.push(chunk);
      if (!contentType && length >= 12) {
        contentType = detectContentType(Buffer.concat(chunks, length));
        if (!contentType) throw invalidMedia();
        if (reportedType && reportedType !== "application/octet-stream" && reportedType !== contentType) {
          throw new MediaInspectionError(
            "media_type_mismatch",
            "The media bytes do not match its Content-Type. Upload the original file directly.",
          );
        }
      }
      if (contentType?.startsWith("video/") && length >= VIDEO_PREFIX_BYTES && size !== undefined) {
        return { size, contentType };
      }
      if (length > MAX_IMAGE_BYTES) {
        throw new MediaInspectionError(
          "media_inspection_limit",
          "This media cannot be validated within the download limit. Use an image under 32 MB or a video URL that reports its file size.",
        );
      }
    }
    if (!contentType || length === 0) throw invalidMedia();
    if (size !== undefined && size !== length) {
      throw new MediaInspectionError(
        "media_incomplete",
        "The media download was incomplete. Upload the original file directly or use a reliable public URL.",
      );
    }
    if (!contentType.startsWith("image/")) return { size: length, contentType };
    const bytes = Buffer.concat(chunks, length);
    try {
      const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000 });
      const metadata = await decoder.metadata();
      await decoder.stats();
      return { size: length, contentType, width: metadata.width, height: metadata.height };
    } catch {
      throw new MediaInspectionError(
        "image_invalid",
        "The image is corrupt, incomplete, or too large to decode. Export it again as JPEG or PNG and upload the file directly.",
      );
    }
  } finally {
    stream.destroy();
  }
}

/** Inspect without cookies/authentication, exactly as a publishing provider must. */
export async function inspectRemoteMedia(url: string): Promise<MediaInspection> {
  validateUrlForSSRF(url);
  try {
    const response = await axios.get<Readable>(url, {
      ...remoteRequestConfig(),
      signal: AbortSignal.timeout(30_000),
      responseType: "stream",
      headers: { "Accept-Encoding": "identity" },
    });
    const rawSize = response.headers["content-length"];
    const size = rawSize === undefined ? undefined : Number(rawSize);
    return await inspectStream(
      response.data,
      Number.isSafeInteger(size) && size! >= 0 ? size : undefined,
      normalizeContentType(String(response.headers["content-type"] ?? ""), ""),
    );
  } catch (error) {
    if (error instanceof MediaInspectionError) throw error;
    throw new MediaInspectionError(
      "media_unavailable",
      "SimplePost couldn't download this media. Upload the file directly or use a public URL that works without signing in.",
    );
  }
}

export async function inspectLocalMedia(filePath: string): Promise<MediaInspection> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw invalidMedia();
    return await inspectStream(createReadStream(filePath), info.size);
  } catch (error) {
    if (error instanceof MediaInspectionError) throw error;
    throw new MediaInspectionError(
      "media_unavailable",
      "SimplePost couldn't read this media file. Check its path and permissions.",
    );
  }
}
