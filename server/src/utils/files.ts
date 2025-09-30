import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {} from "express";
import type {} from "multer";

// Define MulterFile type based on the global Express.Multer.File
type MulterFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
};

export interface TempFile {
  originalName: string;
  tempPath: string;
  filename: string;
}

export async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `simple-post-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

export async function saveTempFiles(files: MulterFile[], tempDir: string): Promise<TempFile[]> {
  const tempFiles: TempFile[] = [];

  for (const file of files) {
    const filename = file.originalname;
    const tempPath = path.join(tempDir, filename);

    await fs.writeFile(tempPath, file.buffer);

    tempFiles.push({
      originalName: file.originalname,
      tempPath,
      filename,
    });
  }

  return tempFiles;
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to cleanup temp directory ${tempDir}:`, error);
  }
}

export function transformMediaPaths<T extends { path?: string }>(media: T[], tempFiles: TempFile[]): T[] {
  if (!media || !Array.isArray(media)) {
    return media;
  }

  return media.map((item) => {
    if (item.path) {
      // Find the temp file by filename
      const tempFile = tempFiles.find((tf) => tf.filename === item.path);
      if (tempFile) {
        return {
          ...item,
          path: tempFile.tempPath,
        };
      }
    }
    return item;
  });
}
