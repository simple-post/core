import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIR = path.resolve(process.cwd(), "data");

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

export function sanitizeFilename(filename: string): string | null {
  const trimmed = filename.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "." || trimmed === "..") {
    return null;
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }

  if (trimmed.includes("\0")) {
    return null;
  }

  return trimmed;
}

export function resolveStoragePath(filename: string, storageDir = getStorageDir()): string {
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

export async function deleteStoredFile(filename: string): Promise<boolean> {
  const storageDir = await ensureStorageDir();
  const filePath = resolveStoragePath(filename, storageDir);

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return false;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  await fs.unlink(filePath);
  return true;
}

export async function resolveStoredMediaPaths<T extends { path?: string; thumbnailPath?: string }>(
  media: T[] | undefined
): Promise<{ resolved: T[] | undefined; missing: string[]; invalid: string[] }> {
  if (!media || !Array.isArray(media)) {
    return { resolved: media, missing: [], invalid: [] };
  }

  const storageDir = await ensureStorageDir();
  const missing = new Set<string>();
  const invalid = new Set<string>();

  const resolved = await Promise.all(
    media.map(async (item) => {
      const nextItem = { ...item };

      if (item.path) {
        const resolvedPath = await resolveStoredFileReference(item.path, storageDir, missing, invalid);
        if (resolvedPath) {
          nextItem.path = resolvedPath;
        }
      }

      if ("thumbnailPath" in item && item.thumbnailPath) {
        const resolvedPath = await resolveStoredFileReference(item.thumbnailPath, storageDir, missing, invalid);
        if (resolvedPath) {
          nextItem.thumbnailPath = resolvedPath;
        }
      }

      return nextItem;
    })
  );

  return {
    resolved,
    missing: [...missing],
    invalid: [...invalid],
  };
}

async function resolveStoredFileReference(
  filename: string,
  storageDir: string,
  missing: Set<string>,
  invalid: Set<string>
): Promise<string | null> {
  const safeName = sanitizeFilename(filename);
  if (!safeName) {
    invalid.add(filename);
    return null;
  }

  const filePath = resolveStoragePath(safeName, storageDir);

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      missing.add(filename);
      return null;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      missing.add(filename);
      return null;
    }
    throw error;
  }

  return filePath;
}
