import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { mediaHeaderMatchesContentType } from "@simple-post/sdk/media-types";

import { ensureStorageDir, getStorageDir, sanitizeFilename } from "../utils/files.js";

import type { MediaFile } from "@simple-post/sdk";

const PUBLIC_PATH = "/media";

function getPublicBaseUrl(): string {
  const configured = process.env.SIMPLE_POST_PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

function buildPublicUrl(filename: string): string {
  return `${getPublicBaseUrl()}${PUBLIC_PATH}/${encodeURIComponent(filename)}`;
}

function inferType(mimeType: string): "image" | "video" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

function safeExtension(originalName: string): string {
  const sanitized = sanitizeFilename(originalName) || "";
  const dot = sanitized.lastIndexOf(".");
  if (dot === -1) return "";
  const ext = sanitized.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

export async function assertUploadMatchesContentType(filePath: string, mimeType: string): Promise<void> {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!mediaHeaderMatchesContentType(header.subarray(0, bytesRead), mimeType)) {
      throw new Error(`Uploaded bytes do not match declared media type ${mimeType}`);
    }
  } finally {
    await handle.close();
  }
}

export async function storeUpload(params: {
  tempPath: string;
  originalName: string;
  mimeType: string;
  size: number;
}): Promise<MediaFile> {
  const type = inferType(params.mimeType);
  if (!type) {
    throw new Error(`Unsupported MIME type: ${params.mimeType}`);
  }

  const ext = safeExtension(params.originalName);
  const id = randomUUID();
  const storedFilename = `${id}${ext}`;

  const storageDir = await ensureStorageDir();
  // Same filesystem (tmp dir lives inside the storage dir), so this is atomic.
  await fs.rename(params.tempPath, path.join(storageDir, storedFilename));

  return {
    id,
    url: buildPublicUrl(storedFilename),
    type,
    filename: params.originalName,
    size: params.size,
  };
}

/**
 * If `url` points back at this server's /media endpoint, returns the local
 * filesystem path so the SDK can read the file directly instead of HTTP-fetching
 * itself. Returns the original URL otherwise.
 */
export function rewriteOwnUrlToPath(url: string): { kind: "path"; path: string } | { kind: "url"; url: string } {
  const base = getPublicBaseUrl();
  if (!url.startsWith(`${base}${PUBLIC_PATH}/`)) {
    return { kind: "url", url };
  }
  const filename = decodeURIComponent(url.slice(`${base}${PUBLIC_PATH}/`.length));
  const safe = sanitizeFilename(filename);
  if (!safe) {
    return { kind: "url", url };
  }
  return { kind: "path", path: path.resolve(getStorageDir(), safe) };
}
