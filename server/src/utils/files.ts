import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_STORAGE_DIR = path.resolve(__dirname, "../../data");

export interface StoredFileInfo {
  filename: string;
  path: string;
  size: number;
  lastModified: string;
}

export function getStorageDir(): string {
  const configured = process.env.SIMPLE_POST_STORAGE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return DEFAULT_STORAGE_DIR;
}

export async function ensureStorageDir(): Promise<string> {
  const storageDir = getStorageDir();
  await fs.mkdir(storageDir, { recursive: true });
  return storageDir;
}

/**
 * Directory for in-flight multipart uploads. Lives inside the storage dir so
 * finalizing an upload is an atomic same-filesystem rename instead of a copy.
 */
export async function ensureUploadTmpDir(): Promise<string> {
  const tmpDir = path.join(getStorageDir(), "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

export function sanitizeFilename(filename: string): string | null {
  const trimmed = filename.trim();
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (trimmed.includes("\0")) return null;
  return trimmed;
}

function resolveStoragePath(filename: string, storageDir = getStorageDir()): string {
  const safeName = sanitizeFilename(filename);
  if (!safeName) {
    throw new Error("Invalid filename");
  }
  const resolvedDir = path.resolve(storageDir);
  const filePath = path.resolve(resolvedDir, safeName);
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`;
  if (!filePath.startsWith(prefix)) {
    throw new Error("Invalid filename");
  }
  return filePath;
}

export async function getStoredFileInfo(filename: string): Promise<StoredFileInfo | null> {
  const storageDir = await ensureStorageDir();
  const filePath = resolveStoragePath(filename, storageDir);

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return {
      filename,
      path: filePath,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
