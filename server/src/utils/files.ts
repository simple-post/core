import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Default storage directory for uploaded files.
 * Located in a 'data' folder relative to the utils directory (../../data from files.ts).
 * This ensures consistent behavior regardless of the current working directory.
 */
const DEFAULT_STORAGE_DIR = path.resolve(__dirname, "../../data");

/**
 * Information about a file stored in the storage directory.
 */
export interface StoredFileInfo {
  /** The sanitized filename as stored on disk */
  filename: string;
  /** The absolute path to the file */
  path: string;
  /** File size in bytes */
  size: number;
  /** ISO 8601 timestamp of when the file was last modified */
  lastModified: string;
}

/**
 * Gets the configured storage directory path.
 *
 * The storage directory can be configured via the `SIMPLE_POST_STORAGE_DIR` environment variable.
 * If not configured, defaults to a 'data' directory relative to this module's location.
 *
 * @returns The absolute path to the storage directory
 *
 * @example
 * ```typescript
 * // With SIMPLE_POST_STORAGE_DIR=/var/uploads
 * getStorageDir(); // Returns '/var/uploads'
 *
 * // Without environment variable
 * getStorageDir(); // Returns '<module-dir>/../../data'
 * ```
 */
export function getStorageDir(): string {
  const configured = process.env.SIMPLE_POST_STORAGE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return DEFAULT_STORAGE_DIR;
}

/**
 * Ensures the storage directory exists, creating it if necessary.
 *
 * This function should be called at server startup to fail fast if the storage
 * directory cannot be created (e.g., due to permissions or disk space issues).
 *
 * @returns A promise that resolves to the absolute path of the storage directory
 * @throws {Error} If the directory cannot be created due to permissions, disk space, or other filesystem errors
 *
 * @example
 * ```typescript
 * // At server startup
 * try {
 *   const storageDir = await ensureStorageDir();
 *   console.log(`Storage directory ready: ${storageDir}`);
 * } catch (error) {
 *   console.error('Failed to initialize storage:', error);
 *   process.exit(1);
 * }
 * ```
 */
export async function ensureStorageDir(): Promise<string> {
  const storageDir = getStorageDir();
  await fs.mkdir(storageDir, { recursive: true });
  return storageDir;
}

/**
 * Sanitizes a filename to prevent directory traversal and other security issues.
 *
 * This function performs the following validations:
 * - Trims leading/trailing whitespace
 * - Rejects empty strings after trimming
 * - Rejects "." and ".." (current/parent directory references)
 * - Rejects filenames containing path separators (/ or \)
 * - Rejects filenames containing null bytes
 *
 * **Security Note:** The returned sanitized filename may differ from the input
 * (e.g., if the input had leading/trailing spaces). Always use the returned
 * value for filesystem operations and client responses.
 *
 * @param filename - The filename to sanitize
 * @returns The sanitized filename, or null if the filename is invalid
 *
 * @example
 * ```typescript
 * sanitizeFilename('photo.jpg');           // Returns 'photo.jpg'
 * sanitizeFilename('  photo.jpg  ');       // Returns 'photo.jpg' (trimmed)
 * sanitizeFilename('../etc/passwd');       // Returns null (path traversal)
 * sanitizeFilename('');                    // Returns null (empty)
 * sanitizeFilename('..');                  // Returns null (parent directory)
 * ```
 */
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

/**
 * Resolves a filename to an absolute path within the storage directory.
 *
 * This function sanitizes the filename and ensures the resolved path is
 * within the storage directory, preventing directory traversal attacks.
 *
 * @param filename - The filename to resolve
 * @param storageDir - Optional storage directory override (defaults to getStorageDir())
 * @returns The absolute path to the file within the storage directory
 * @throws {Error} If the filename is invalid or would resolve outside the storage directory
 *
 * @example
 * ```typescript
 * resolveStoragePath('photo.jpg');          // Returns '/path/to/storage/photo.jpg'
 * resolveStoragePath('../etc/passwd');      // Throws Error: Invalid filename
 * ```
 */
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

/**
 * Retrieves information about a stored file.
 *
 * @param filename - The filename to look up (will be sanitized)
 * @returns A promise that resolves to the file info, or null if the file doesn't exist or is not a regular file
 * @throws {Error} If the filename is invalid or a filesystem error occurs (other than file not found)
 *
 * @example
 * ```typescript
 * const info = await getStoredFileInfo('photo.jpg');
 * if (info) {
 *   console.log(`File size: ${info.size} bytes`);
 *   console.log(`Last modified: ${info.lastModified}`);
 * } else {
 *   console.log('File not found');
 * }
 * ```
 */
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

/**
 * Deletes a stored file.
 *
 * This function handles race conditions gracefully - if another process deletes
 * the file between the existence check and the unlink operation, it will return
 * false instead of throwing an error.
 *
 * @param filename - The filename to delete (will be sanitized)
 * @returns A promise that resolves to true if the file was deleted, false if it didn't exist
 * @throws {Error} If the filename is invalid or a filesystem error occurs (other than file not found)
 *
 * @example
 * ```typescript
 * const deleted = await deleteStoredFile('photo.jpg');
 * if (deleted) {
 *   console.log('File deleted successfully');
 * } else {
 *   console.log('File did not exist');
 * }
 * ```
 */
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

  // Handle race condition: file might be deleted by another process between stat and unlink
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      // File was deleted by another process between our check and unlink - treat as success
      return false;
    }
    throw error;
  }
}

/**
 * Resolves media paths in an array of media items, converting filenames to absolute paths.
 *
 * This function is useful for processing post requests where media items may reference
 * files by filename that need to be resolved to their actual storage paths.
 *
 * @typeParam T - Type of media items, must have optional `path` and `thumbnailPath` properties
 * @param media - Array of media items to process, or undefined
 * @returns An object containing:
 *   - `resolved`: The media array with paths resolved to absolute storage paths
 *   - `missing`: Array of filenames that don't exist in storage
 *   - `invalid`: Array of filenames that failed sanitization
 *
 * @example
 * ```typescript
 * const { resolved, missing, invalid } = await resolveStoredMediaPaths([
 *   { path: 'photo.jpg' },
 *   { path: 'video.mp4', thumbnailPath: 'thumb.jpg' }
 * ]);
 *
 * if (missing.length > 0) {
 *   console.log('Missing files:', missing);
 * }
 * ```
 */
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

/**
 * Internal helper to resolve a single file reference to its absolute path.
 *
 * @param filename - The filename to resolve
 * @param storageDir - The storage directory path
 * @param missing - Set to add missing file names to
 * @param invalid - Set to add invalid file names to
 * @returns The absolute path if file exists, null otherwise
 */
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
