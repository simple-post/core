import { uploadFromBuffer, generateFileKey } from "@simple-post/sdk";
import { z } from "zod";

import { mediaLogger, serializeError } from "@/lib/logger";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@/lib/utils/media-types";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const STORAGE_UPLOAD_TIMEOUT_MS = 20_000;

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

const chatGptFileParamSchema = z
  .object({
    download_url: z.string().url().describe("Temporary ChatGPT file download URL."),
    file_id: z.string().min(1).describe("ChatGPT file id."),
    file_name: z.string().min(1).optional().describe("Original filename when provided by ChatGPT."),
    name: z.string().min(1).optional().describe("Original filename when provided by the host."),
    mime_type: z.string().min(1).optional().describe("MIME type when provided by ChatGPT."),
    mimeType: z.string().min(1).optional().describe("MIME type when provided by the host."),
    size: z.number().optional().describe("File size in bytes when provided by the host."),
  })
  .passthrough();

export const uploadMediaSchema = z.object({
  file: chatGptFileParamSchema.describe(
    "Required ChatGPT file parameter for an image or video generated, attached, uploaded, or selected in ChatGPT. Do not pass file bytes as base64 tool arguments.",
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
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

function uploadTimeoutMessage(action: string): string {
  return `Timed out ${action} after ${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)} seconds`;
}

function remainingMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
      onTimeout?.();
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

function filenameFromContentDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;

  const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].replaceAll(/^"|"$/g, ""));
    } catch {
      return utf8[1].replaceAll(/^"|"$/g, "");
    }
  }

  const ascii = contentDisposition.match(/filename="?([^";]+)"?/i);
  return ascii?.[1];
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

function assertCompleteMedia(buffer: Buffer, mimeType: string): void {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const sniffedImageType = sniffImageMimeType(buffer);

  if (mimeType.startsWith("image/") && sniffedImageType !== mimeType) {
    throw new Error(`Media bytes do not match MIME type ${mimeType}`);
  }

  if (mimeType === "image/jpeg" && !hasJpegEndMarker(buffer)) {
    throw new Error("Invalid or incomplete JPEG data");
  }
  if (mimeType === "image/png" && !hasPngEndChunk(buffer)) {
    throw new Error("Invalid or incomplete PNG data");
  }
  if (mimeType === "image/gif" && buffer.at(-1) !== 59) {
    throw new Error("Invalid or incomplete GIF data");
  }
  if (mimeType === "image/webp") {
    const expectedLength = buffer.readUInt32LE(4) + 8;
    if (expectedLength > buffer.length) {
      throw new Error("Invalid or incomplete WebP data");
    }
  }
  if ((mimeType === "video/mp4" || mimeType === "video/quicktime") && !hasMp4FileTypeBox(buffer)) {
    throw new Error(`Media bytes do not match MIME type ${mimeType}`);
  }
  if (mimeType === "video/webm" && !hasWebmHeader(buffer)) {
    throw new Error("Media bytes do not match MIME type video/webm");
  }
}

function resolveMimeType(buffer: Buffer, declaredMimeType: string | undefined, filename: string): string {
  const normalized = normalizeContentType(declaredMimeType ?? "", filename);
  const sniffedImageType = sniffImageMimeType(buffer);
  const resolvedType = sniffedImageType ?? normalized;

  if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
    throw new Error(
      `Unsupported media type${declaredMimeType ? `: ${declaredMimeType}` : ""}. Allowed: ${[...ALLOWED_MEDIA_TYPES].join(", ")}`,
    );
  }

  assertCompleteMedia(buffer, resolvedType);
  return resolvedType;
}

async function readResponseBuffer(response: Response, deadline: number, onTimeout: () => void): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  if (!response.body) {
    const arrayBuffer = await withTimeout(
      response.arrayBuffer(),
      remainingMs(deadline),
      uploadTimeoutMessage("downloading ChatGPT file"),
      onTimeout,
    );
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error("Downloaded file is empty");
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await withTimeout(
        reader.read(),
        remainingMs(deadline),
        uploadTimeoutMessage("downloading ChatGPT file"),
        () => {
          onTimeout();
          void reader.cancel();
        },
      );
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > MAX_FILE_SIZE) {
        await reader.cancel();
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (received === 0) {
    throw new Error("Downloaded file is empty");
  }

  return Buffer.concat(chunks, received);
}

async function resolveUploadSource(input: UploadMediaInput): Promise<ResolvedUploadSource> {
  const inputFileSize = input.file.size ?? 0;

  if (inputFileSize > 0 && inputFileSize > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const controller = new AbortController();
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;

  const response = await withTimeout(
    fetch(input.file.download_url, {
      signal: controller.signal,
    }),
    remainingMs(deadline),
    uploadTimeoutMessage("downloading ChatGPT file"),
    () => controller.abort(),
  );

  if (!response.ok) {
    throw new Error(`Failed to download ChatGPT file: ${response.status} ${response.statusText}`);
  }

  const buffer = await readResponseBuffer(response, deadline, () => controller.abort());
  const responseType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const filename =
    input.filename ??
    input.file.file_name ??
    input.file.name ??
    filenameFromContentDisposition(response.headers.get("content-disposition")) ??
    filenameFromUrl(input.file.download_url) ??
    `${input.file.file_id}.${extensionForMimeType(input.file.mime_type ?? input.file.mimeType ?? responseType ?? "application/octet-stream")}`;
  const mimeType = resolveMimeType(
    buffer,
    input.mimeType ?? input.file.mime_type ?? input.file.mimeType ?? responseType,
    filename,
  );

  return {
    buffer,
    filename: ensureFilenameExtension(filename, mimeType),
    mimeType,
  };
}

export async function uploadMedia(userId: string, input: UploadMediaInput) {
  const startedAt = Date.now();
  const sourceType = "file_param";

  try {
    log.info(
      { sourceType, hasFilename: Boolean(input.filename), hasMimeType: Boolean(input.mimeType) },
      "Starting MCP media upload",
    );

    const source = await resolveUploadSource(input);
    log.info(
      {
        sourceType,
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.buffer.length,
        elapsedMs: Date.now() - startedAt,
      },
      "Resolved MCP media upload source",
    );

    const key = generateFileKey(userId, source.filename);
    const uploadStartedAt = Date.now();
    const url = await uploadFromBuffer(source.buffer, key, source.mimeType, {
      timeoutMs: STORAGE_UPLOAD_TIMEOUT_MS,
    });
    log.info(
      {
        sourceType,
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.buffer.length,
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
      size: source.buffer.length,
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
  }
}
