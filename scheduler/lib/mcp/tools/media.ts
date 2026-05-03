import { uploadFromBuffer, generateFileKey } from "@simple-post/sdk";
import { z } from "zod";

import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@/lib/utils/media-types";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const chatGptFileParamSchema = z
  .object({
    download_url: z.string().url().describe("Temporary ChatGPT file download URL."),
    file_id: z.string().min(1).describe("ChatGPT file id."),
  })
  .strict();

export const uploadMediaSchema = z.object({
  file: chatGptFileParamSchema
    .optional()
    .describe(
      "ChatGPT file parameter for an image or video generated, attached, uploaded, or selected in ChatGPT. Prefer this over data when available.",
    ),
  filename: z
    .string()
    .min(1)
    .optional()
    .describe("Original filename including extension, e.g. 'photo.jpg' or 'clip.mp4'. Required when using data."),
  mimeType: z
    .string()
    .min(1)
    .optional()
    .describe(
      "MIME type of the file. Supported: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm. Required when using data unless data is a data URL.",
    ),
  data: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Base64-encoded file contents. Use only when file is unavailable; do not include large ChatGPT images here.",
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

function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSION[mimeType] ?? "bin";
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
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
      return decodeURIComponent(utf8[1].replace(/^"|"$/g, ""));
    } catch {
      return utf8[1].replace(/^"|"$/g, "");
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

function parseDataUrl(value: string): { base64: string; mimeType?: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:([^;,]+)?;base64,([\s\S]*)$/i);
  if (!match) return { base64: trimmed };

  return {
    mimeType: match[1]?.toLowerCase(),
    base64: match[2],
  };
}

function decodeBase64Data(value: string): { buffer: Buffer; mimeType?: string } {
  const { base64, mimeType } = parseDataUrl(value);
  const compact = base64.replace(/\s/g, "");

  if (!compact) {
    throw new Error("File is empty or base64 data is invalid");
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("Invalid base64 data");
  }

  const padded = compact.padEnd(compact.length + ((4 - (compact.length % 4)) % 4), "=");
  const buffer = Buffer.from(padded, "base64");
  const canonicalInput = compact.replace(/=+$/g, "");
  const canonicalOutput = buffer.toString("base64").replace(/=+$/g, "");

  if (buffer.length === 0 || canonicalInput !== canonicalOutput) {
    throw new Error("Invalid base64 data");
  }

  return { buffer, mimeType };
}

function sniffImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
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
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) return true;
  }
  return false;
}

function hasPngEndChunk(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  for (let i = buffer.length - 12; i >= Math.max(0, buffer.length - 4096); i -= 1) {
    if (
      buffer[i] === 0x00 &&
      buffer[i + 1] === 0x00 &&
      buffer[i + 2] === 0x00 &&
      buffer[i + 3] === 0x00 &&
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
  return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
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
  if (mimeType === "image/gif" && buffer[buffer.length - 1] !== 0x3b) {
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

async function readResponseBuffer(response: Response): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error("Downloaded file is empty");
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }
  return buffer;
}

async function resolveUploadSource(input: UploadMediaInput): Promise<ResolvedUploadSource> {
  if (input.file) {
    const response = await fetch(input.file.download_url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to download ChatGPT file: ${response.status} ${response.statusText}`);
    }

    const buffer = await readResponseBuffer(response);
    const responseType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const filename =
      input.filename ??
      filenameFromContentDisposition(response.headers.get("content-disposition")) ??
      filenameFromUrl(input.file.download_url) ??
      `${input.file.file_id}.${extensionForMimeType(responseType ?? "application/octet-stream")}`;
    const mimeType = resolveMimeType(buffer, input.mimeType ?? responseType, filename);

    return {
      buffer,
      filename: ensureFilenameExtension(filename, mimeType),
      mimeType,
    };
  }

  if (!input.data) {
    throw new Error("Provide either a ChatGPT file parameter in file or base64 data in data");
  }
  if (!input.filename) {
    throw new Error("filename is required when uploading base64 data");
  }

  const { buffer, mimeType: dataUrlMimeType } = decodeBase64Data(input.data);
  const mimeType = resolveMimeType(buffer, input.mimeType ?? dataUrlMimeType, input.filename);

  return {
    buffer,
    filename: ensureFilenameExtension(input.filename, mimeType),
    mimeType,
  };
}

export async function uploadMedia(userId: string, input: UploadMediaInput) {
  const source = await resolveUploadSource(input);
  const key = generateFileKey(userId, source.filename);
  const url = await uploadFromBuffer(source.buffer, key, source.mimeType);

  return {
    kind: "media_upload" as const,
    type: source.mimeType.startsWith("video/") ? ("video" as const) : ("image" as const),
    url,
    filename: source.filename,
    size: source.buffer.length,
    mimeType: source.mimeType,
  };
}
