import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { v4 as uuidv4 } from "uuid";

import { mediaLogger, serializeError } from "@/lib/logger";

/**
 * Downloads a file from a URL to a local temporary path
 * @param url - The URL of the file to download
 * @param filename - The filename to save as
 * @returns The local path where the file was saved
 */
export async function downloadFile(url: string, filename: string): Promise<string> {
  try {
    // Create a temporary directory for downloads
    const tempDir = path.join(tmpdir(), "simplepost-uploads");
    await mkdir(tempDir, { recursive: true });

    // Generate a unique filename to avoid collisions
    const uniqueFilename = `${uuidv4()}_${filename}`;
    const localPath = path.join(tempDir, uniqueFilename);

    // Download the file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(localPath, Buffer.from(buffer));

    return localPath;
  } catch (error) {
    mediaLogger.error({ err: serializeError(error), filename, url }, "Error downloading file");
    throw error;
  }
}
