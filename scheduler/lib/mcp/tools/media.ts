import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";

import { downloadToTempFile, generateFileKey, S3MediaUploader } from "@simple-post/sdk";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@simple-post/sdk/media-types";
import { z } from "zod";

import { mediaLogger, serializeError } from "@/lib/logger";
import { McpToolError } from "@/lib/mcp/tool-errors";
import { API_UPLOAD_MAX_BYTES } from "@/lib/media-limits";
import { ApiError } from "@/lib/utils/errors";

const MAX_FILE_SIZE = API_UPLOAD_MAX_BYTES;
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

export const UPLOAD_MEDIA_DESCRIPTION =
  "Import an image or video into SimplePost storage from either an external URL or a registered file parameter supplied by the current chat client. Pass exactly one of url or file. Never construct, copy, or reuse a file reference. If a file call fails with UNREGISTERED_FILE_REFERENCE and the same media has a public URL, retry once with url and omit file; otherwise ask the user to reattach it and do not retry the same reference. Returns a public media URL and metadata for posting tools.";

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
  file: fileParamSchema
    .optional()
    .describe(
      "Registered image or video file parameter supplied directly by the current chat client. Pass it unchanged; never construct it from a file id, filename, path, or earlier message. Provide either file or url. Supported: JPEG, PNG, GIF, WebP, MP4, QuickTime, WebM. Do not pass base64 bytes.",
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe("External media URL to import into SimplePost storage. Provide either url or file."),
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

const FILE_TOO_LARGE_MESSAGE = `This file is too large — the maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MiB.`;

function mediaError(
  code: string,
  message: string,
  stage: ConstructorParameters<typeof McpToolError>[0]["stage"],
  recovery: ConstructorParameters<typeof McpToolError>[0]["recovery"],
  maxAutomaticRetries = 0,
  statusCode = 400,
  cause?: unknown,
): McpToolError {
  const error = new McpToolError({ code, message, stage, recovery, maxAutomaticRetries, statusCode });
  if (cause !== undefined) error.cause = cause;
  return error;
}

function tooLargeError(): McpToolError {
  return mediaError("MEDIA_TOO_LARGE", FILE_TOO_LARGE_MESSAGE, "media_validation", "replace_media");
}

function corruptedFileError(mimeType: string): McpToolError {
  return mediaError(
    "MEDIA_CORRUPT",
    `This ${mimeLabel(mimeType)} appears to be corrupted or incomplete. Please re-upload it or try a different file.`,
    "media_validation",
    "replace_media",
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
    throw tooLargeError();
  }

  const sniffedImageType = sniffImageMimeType(header);

  if (mimeType.startsWith("image/") && sniffedImageType !== mimeType) {
    throw mediaError(
      "MEDIA_TYPE_MISMATCH",
      `This file doesn't appear to be a valid ${mimeLabel(mimeType)}. Please re-upload it or try a different file.`,
      "media_validation",
      "replace_media",
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
    throw mediaError(
      "MEDIA_TYPE_MISMATCH",
      `This file doesn't appear to be a valid ${mimeLabel(mimeType)}. Please re-upload it or try a different file.`,
      "media_validation",
      "replace_media",
    );
  }
  if (mimeType === "video/webm" && !hasWebmHeader(header)) {
    throw mediaError(
      "MEDIA_TYPE_MISMATCH",
      "This file doesn't appear to be a valid WebM video. Please re-upload it or try a different file.",
      "media_validation",
      "replace_media",
    );
  }
}

function resolveMimeType(sample: MediaSample, declaredMimeType: string | undefined, filename: string): string {
  const normalized = normalizeContentType(declaredMimeType ?? "", filename);
  const sniffedImageType = sniffImageMimeType(sample.header);
  const resolvedType = sniffedImageType ?? normalized;

  if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
    const textPrefix = sample.header.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
    const appearsToBeHtml = textPrefix.startsWith("<!doctype html") || textPrefix.startsWith("<html");
    throw mediaError(
      appearsToBeHtml ? "MEDIA_SOURCE_NOT_MEDIA" : "MEDIA_UNSUPPORTED_TYPE",
      appearsToBeHtml
        ? "The media URL returned an HTML page instead of an image or video. Provide a direct, publicly downloadable media URL."
        : `This file type${declaredMimeType ? ` (${declaredMimeType})` : ""} isn't supported. Supported formats: ${[...ALLOWED_MEDIA_TYPES].map((type) => mimeLabel(type)).join(", ")}.`,
      "media_validation",
      "replace_media",
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
      throw mediaError(
        "MEDIA_EMPTY",
        "The downloaded file is empty. Please re-attach the file and try again.",
        "media_validation",
        "reattach",
      );
    }
    if (size > MAX_FILE_SIZE) {
      throw tooLargeError();
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
  if (Boolean(input.file) === Boolean(input.url)) {
    throw mediaError("MEDIA_SOURCE_REQUIRED", "Provide exactly one media source: file or url.", "tool_input", "stop");
  }

  const inputFileSize = input.file?.size ?? 0;

  if (inputFileSize > 0 && inputFileSize > MAX_FILE_SIZE) {
    throw tooLargeError();
  }

  // Use the SDK's bounded, DNS-pinned downloader so a crafted file parameter
  // cannot reach loopback, private networks, cloud metadata, or an unsafe
  // redirect target.
  const sourceUrl = input.file?.download_url ?? input.url!;
  let tempPath: string;
  try {
    tempPath = await downloadToTempFile(sourceUrl);
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown; response?: { status?: unknown } };
    const status = typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
    const errorCode = typeof candidate.code === "string" ? candidate.code : "";
    const errorMessage = typeof candidate.message === "string" ? candidate.message : "";
    if (status === 413 || /exceeds the maximum download size/i.test(errorMessage)) throw tooLargeError();
    if (input.file) {
      throw mediaError(
        "MEDIA_FILE_REFERENCE_UNAVAILABLE",
        "The attached file could not be downloaded. If the same media has a public URL, retry upload_media once with url and omit file. Otherwise ask the user to reattach the file in their current message; do not retry the same file reference.",
        "source_download",
        "retry_with_url_or_reattach",
        1,
        400,
        error,
      );
    }
    if (status === 401 || status === 403) {
      throw mediaError(
        "MEDIA_SOURCE_AUTH_REQUIRED",
        "The media URL requires authentication. Provide a direct, publicly downloadable media URL.",
        "source_download",
        "replace_media",
        0,
        400,
        error,
      );
    }
    if (status === 404 || status === 410) {
      throw mediaError(
        "MEDIA_SOURCE_EXPIRED",
        "The media URL is missing or expired. Provide a fresh public URL or reattach the file.",
        "source_download",
        "replace_media",
        0,
        400,
        error,
      );
    }
    const transient =
      status === 408 ||
      status === 429 ||
      (status !== undefined && status >= 500) ||
      ["ECONNABORTED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(errorCode);
    throw mediaError(
      "MEDIA_SOURCE_UNAVAILABLE",
      transient
        ? "The media URL could not be downloaded because of a temporary network or origin failure. Retry once."
        : "The media URL could not be downloaded. Provide a direct, publicly downloadable media URL.",
      "source_download",
      transient ? "retry_same" : "replace_media",
      transient ? 1 : 0,
      transient ? 503 : 400,
      error,
    );
  }
  try {
    const sample = await readMediaSample(tempPath);

    const declaredType = input.mimeType ?? input.file?.mime_type ?? input.file?.mimeType;
    const filename =
      input.filename ??
      input.file?.file_name ??
      input.file?.name ??
      filenameFromUrl(sourceUrl) ??
      `${input.file?.file_id ?? "media"}.${extensionForMimeType(declaredType ?? "application/octet-stream")}`;
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
  const sourceType = input.url ? "external_url" : "file_param";
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
    // Construct the uploader first: if storage is unconfigured it throws here,
    // and an already-open read stream would leak because the try/finally that
    // destroys it has not started yet.
    const uploader = new S3MediaUploader();
    const uploadStream = createReadStream(source.tempPath);
    // Once the upload fails nothing consumes this stream, and the outer finally
    // unlinks the file — possibly while its fs.open is still in flight. With no
    // listener that late ENOENT becomes an unhandled error event and takes the
    // process down. A genuine read error still reaches the uploader, which owns
    // reporting it.
    uploadStream.on("error", () => {});
    let url: string;
    try {
      try {
        url = await uploader.uploadStream(uploadStream, key, source.mimeType, {
          timeoutMs: STORAGE_UPLOAD_TIMEOUT_MS,
        });
      } catch (error) {
        throw mediaError(
          "MEDIA_STORAGE_FAILED",
          "SimplePost could not store the validated media because of a temporary storage failure. Retry once.",
          "storage_upload",
          "retry_same",
          1,
          503,
          error,
        );
      }
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
    const isClientError = error instanceof ApiError && error.statusCode < 500;
    log[isClientError ? "warn" : "error"](
      {
        sourceType,
        elapsedMs: Date.now() - startedAt,
        err: serializeError(error),
      },
      isClientError ? "MCP media upload rejected" : "Failed MCP media upload",
    );
    throw error;
  } finally {
    if (source) {
      await unlink(source.tempPath).catch(() => {});
    }
  }
}
