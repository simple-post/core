import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";

import { downloadToTempFile, generateFileKey, S3MediaUploader } from "@simple-post/sdk";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@simple-post/sdk/media-types";
import { z } from "zod";

import { mediaLogger, serializeError } from "@/lib/logger";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const log = mediaLogger.child({ tool: "mcp.upload_media" });

const fileParamSchema = z
  .object({
    download_url: z.string().url().describe("Temporary file download URL provided by the chat client."),
    file_id: z.string().min(1).describe("File id assigned by the chat client."),
    file_name: z.string().min(1).optional().describe("Original filename when provided by the chat client."),
    name: z.string().min(1).optional().describe("Original filename when provided by the host."),
    mime_type: z.string().min(1).optional().describe("MIME type when provided by the chat client."),
    mimeType: z.string().min(1).optional().describe("MIME type when provided by the host."),
    size: z.number().optional().describe("File size in bytes when provided by the host."),
  })
  .passthrough();

export const uploadMediaSchema = z.object({
  file: fileParamSchema.describe(
    "Required file parameter for an image or video generated, attached, uploaded, or selected in the chat. Do not pass file bytes as base64 tool arguments.",
  ),
  filename: z
    .string()
    .min(1)
    .optional()
    .describe("Optional filename override including extension, e.g. 'photo.jpg' or 'clip.mp4'."),
  mimeType: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional MIME type override. Supported: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm.",
    ),
});

export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;

export const uploadMediaOutputSchema = z.object({
  kind: z.literal("media_upload"),
  type: z.enum(["image", "video"]),
  url: z.string().url(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string(),
});

interface ResolvedUploadSource {
  filename: string;
  mimeType: string;
  size: number;
  tempPath: string;
}

interface MediaSample {
  header: Buffer;
  size: number;
  tail: Buffer;
}

const MIME_LABEL: Record<string, string> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/gif": "GIF image",
  "image/webp": "WebP image",
  "video/mp4": "MP4 video",
  "video/quicktime": "QuickTime video",
  "video/webm": "WebM video",
};

function mimeLabel(mimeType: string): string {
  return MIME_LABEL[mimeType] ?? mimeType;
}

const FILE_TOO_LARGE_MESSAGE = `This file is too large — the maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`;

function corruptedFileError(mimeType: string): Error {
  return new Error(
    `This ${mimeLabel(mimeType)} appears to be corrupted or incomplete. Please re-upload it or try a different file.`,
  );
}

function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSION[mimeType] ?? "bin";
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").findLast(Boolean);
    return name ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

function ensureFilenameExtension(filename: string, mimeType: string): string {
  const desired = extensionForMimeType(mimeType);
  const withoutQuery = filename.split(/[?#]/)[0] || "media";
  const current = withoutQuery.split(".").pop()?.toLowerCase();
  const validForType =
    (mimeType === "image/jpeg" && (current === "jpg" || current === "jpeg")) ||
    (mimeType === "video/mp4" && (current === "mp4" || current === "m4v")) ||
    current === desired;

  if (validForType) return withoutQuery;

  const stem = withoutQuery.includes(".") ? withoutQuery.slice(0, withoutQuery.lastIndexOf(".")) : withoutQuery;
  return `${stem || "media"}.${desired}`;
}

function sniffImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 137 &&
    buffer[1] === 80 &&
    buffer[2] === 78 &&
    buffer[3] === 71 &&
    buffer[4] === 13 &&
    buffer[5] === 10 &&
    buffer[6] === 26 &&
    buffer[7] === 10
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return undefined;
}

function hasJpegEndMarker(buffer: Buffer): boolean {
  for (let i = buffer.length - 2; i >= Math.max(0, buffer.length - 4096); i -= 1) {
    if (buffer[i] === 255 && buffer[i + 1] === 217) return true;
  }
  return false;
}

function hasPngEndChunk(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  for (let i = buffer.length - 12; i >= Math.max(0, buffer.length - 4096); i -= 1) {
    if (
      buffer[i] === 0 &&
      buffer[i + 1] === 0 &&
      buffer[i + 2] === 0 &&
      buffer[i + 3] === 0 &&
      buffer.subarray(i + 4, i + 8).toString("ascii") === "IEND"
    ) {
      return true;
    }
  }
  return false;
}

function hasMp4FileTypeBox(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function hasWebmHeader(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163;
}

function assertCompleteMedia({ header, size, tail }: MediaSample, mimeType: string): void {
  if (size > MAX_FILE_SIZE) {
    throw new Error(FILE_TOO_LARGE_MESSAGE);
  }

  const sniffedImageType = sniffImageMimeType(header);

  if (mimeType.startsWith("image/") && sniffedImageType !== mimeType) {
    throw new Error(
      `This file doesn't appear to be a valid ${mimeLabel(mimeType)}. Please re-upload it or try a different file.`,
    );
  }

  if (mimeType === "image/jpeg" && !hasJpegEndMarker(tail)) {
    throw corruptedFileError(mimeType);
  }
  if (mimeType === "image/png" && !hasPngEndChunk(tail)) {
    throw corruptedFileError(mimeType);
  }
  if (mimeType === "image/gif" && tail.at(-1) !== 59) {
    throw corruptedFileError(mimeType);
  }
  if (mimeType === "image/webp") {
    const expectedLength = header.readUInt32LE(4) + 8;
    if (expectedLength > size) {
      throw corruptedFileError(mimeType);
    }
  }
  if ((mimeType === "video/mp4" || mimeType === "video/quicktime") && !hasMp4FileTypeBox(header)) {
    throw new Error(
      `This file doesn't appear to be a valid ${mimeLabel(mimeType)}. Please re-upload it or try a different file.`,
    );
  }
  if (mimeType === "video/webm" && !hasWebmHeader(header)) {
    throw new Error("This file doesn't appear to be a valid WebM video. Please re-upload it or try a different file.");
  }
}

function resolveMimeType(sample: MediaSample, declaredMimeType: string | undefined, filename: string): string {
  const normalized = normalizeContentType(declaredMimeType ?? "", filename);
  const sniffedImageType = sniffImageMimeType(sample.header);
  const resolvedType = sniffedImageType ?? normalized;

  if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
    throw new Error(
      `This file type${declaredMimeType ? ` (${declaredMimeType})` : ""} isn't supported. Supported formats: ${[...ALLOWED_MEDIA_TYPES].map((type) => mimeLabel(type)).join(", ")}.`,
    );
  }

  assertCompleteMedia(sample, resolvedType);
  return resolvedType;
}

async function readMediaSample(tempPath: string): Promise<MediaSample> {
  const file = await open(tempPath, "r");
  try {
    const { size } = await file.stat();
    if (size === 0) {
      throw new Error("The downloaded file is empty. Please re-attach the file and try again.");
    }
    if (size > MAX_FILE_SIZE) {
      throw new Error(FILE_TOO_LARGE_MESSAGE);
    }

    const header = Buffer.alloc(Math.min(size, 32));
    const tail = Buffer.alloc(Math.min(size, 4096));
    await file.read(header, 0, header.length, 0);
    await file.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    return { header, size, tail };
  } finally {
    await file.close();
  }
}

async function resolveUploadSource(input: UploadMediaInput): Promise<ResolvedUploadSource> {
  const inputFileSize = input.file.size ?? 0;

  if (inputFileSize > 0 && inputFileSize > MAX_FILE_SIZE) {
    throw new Error(FILE_TOO_LARGE_MESSAGE);
  }

  // Use the SDK's bounded, DNS-pinned downloader so a crafted file parameter
  // cannot reach loopback, private networks, cloud metadata, or an unsafe
  // redirect target.
  const tempPath = await downloadToTempFile(input.file.download_url);
  try {
    const sample = await readMediaSample(tempPath);

    const declaredType = input.mimeType ?? input.file.mime_type ?? input.file.mimeType;
    const filename =
      input.filename ??
      input.file.file_name ??
      input.file.name ??
      filenameFromUrl(input.file.download_url) ??
      `${input.file.file_id}.${extensionForMimeType(declaredType ?? "application/octet-stream")}`;
    const mimeType = resolveMimeType(sample, declaredType, filename);

    return {
      filename: ensureFilenameExtension(filename, mimeType),
      mimeType,
      size: sample.size,
      tempPath,
    };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function uploadMedia(userId: string, input: UploadMediaInput) {
  const startedAt = Date.now();
  const sourceType = "file_param";
  let source: ResolvedUploadSource | undefined;

  try {
    log.info(
      { sourceType, hasFilename: Boolean(input.filename), hasMimeType: Boolean(input.mimeType) },
      "Starting MCP media upload",
    );

    source = await resolveUploadSource(input);
    log.info(
      {
        sourceType,
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.size,
        elapsedMs: Date.now() - startedAt,
      },
      "Resolved MCP media upload source",
    );

    const key = generateFileKey(userId, source.filename);
    const uploadStartedAt = Date.now();
    const uploadStream = createReadStream(source.tempPath);
    const uploader = new S3MediaUploader();
    let url: string;
    try {
      url = await uploader.uploadStream(uploadStream, key, source.mimeType, {
        timeoutMs: STORAGE_UPLOAD_TIMEOUT_MS,
      });
    } finally {
      uploadStream.destroy();
    }
    log.info(
      {
        sourceType,
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.size,
        storageElapsedMs: Date.now() - uploadStartedAt,
        totalElapsedMs: Date.now() - startedAt,
      },
      "Completed MCP media upload",
    );

    return {
      kind: "media_upload" as const,
      type: source.mimeType.startsWith("video/") ? ("video" as const) : ("image" as const),
      url,
      filename: source.filename,
      size: source.size,
      mimeType: source.mimeType,
    };
  } catch (error) {
    log.error(
      {
        sourceType,
        elapsedMs: Date.now() - startedAt,
        err: serializeError(error),
      },
      "Failed MCP media upload",
    );
    throw error;
  } finally {
    if (source) {
      await unlink(source.tempPath).catch(() => {});
    }
  }
}
