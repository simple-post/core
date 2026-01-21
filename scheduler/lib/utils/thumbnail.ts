import { execSync } from "node:child_process";

import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";

import { mediaLogger, serializeError } from "@/lib/logger";

// Try to find ffmpeg on the system PATH
async function getFFmpegPath(): Promise<string> {
  try {
    // First, try to use system ffmpeg
    const ffmpegPath = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (ffmpegPath) {
      return ffmpegPath;
    }
  } catch {
    // If system ffmpeg not found, try the installer package
    try {
      const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
      return ffmpegInstaller.path;
    } catch {
      throw new Error(
        "FFmpeg not found. Please install FFmpeg on your system or ensure @ffmpeg-installer/ffmpeg is properly installed.",
      );
    }
  }
  throw new Error("FFmpeg not found");
}

// Set the ffmpeg path (using void to satisfy linter)
void getFFmpegPath()
  .then((ffmpegPath) => {
    ffmpeg.setFfmpegPath(ffmpegPath);
    mediaLogger.info({ ffmpegPath }, "Using FFmpeg");
  })
  .catch((error) => {
    mediaLogger.error({ err: serializeError(error) }, "FFmpeg setup error");
  });

interface ThumbnailResult {
  buffer: Buffer;
  filename: string;
}

/**
 * Generate a thumbnail for an image
 * @param buffer - The image buffer
 * @param filename - Original filename
 * @returns Thumbnail buffer and filename
 */
export async function generateImageThumbnail(buffer: Buffer, filename: string): Promise<ThumbnailResult> {
  const thumbnailBuffer = await sharp(buffer)
    .resize(400, 400, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  const nameWithoutExt = filename.slice(0, Math.max(0, filename.lastIndexOf(".")));
  const thumbnailFilename = `${nameWithoutExt}_thumb.jpg`;

  return {
    buffer: thumbnailBuffer,
    filename: thumbnailFilename,
  };
}

/**
 * Generate a thumbnail for a video
 * @param buffer - The video buffer
 * @param filename - Original filename
 * @returns Thumbnail buffer and filename
 */
export async function generateVideoThumbnail(buffer: Buffer, filename: string): Promise<ThumbnailResult> {
  const fs = await import("node:fs/promises");
  const tempVideoFilename = `temp-video-${Date.now()}-${Math.random().toString(36).slice(7)}.mp4`;
  const tempVideoPath = `/tmp/${tempVideoFilename}`;
  const tempThumbnailFilename = `temp-thumbnail-${Date.now()}-${Math.random().toString(36).slice(7)}.jpg`;
  const tempThumbnailPath = `/tmp/${tempThumbnailFilename}`;

  // Write video buffer to a temporary file (ffmpeg needs a file, not a stream)
  await fs.writeFile(tempVideoPath, buffer);

  return new Promise((resolve, reject) => {
    ffmpeg(tempVideoPath)
      .screenshots({
        count: 1,
        folder: "/tmp",
        filename: tempThumbnailFilename,
        size: "400x?",
        timestamps: ["00:00:01"], // Extract frame at 1 second
      })
      .on("end", () => {
        // Read the generated thumbnail
        fs.readFile(tempThumbnailPath)
          .then((thumbnailBuffer) => {
            // Clean up temp files
            Promise.all([
              fs.unlink(tempVideoPath).catch(() => {}),
              fs.unlink(tempThumbnailPath).catch(() => {}),
            ]).finally(() => {
              const nameWithoutExt = filename.slice(0, Math.max(0, filename.lastIndexOf(".")));
              const thumbnailFilename = `${nameWithoutExt}_thumb.jpg`;

              resolve({
                buffer: thumbnailBuffer,
                filename: thumbnailFilename,
              });
            });
          })
          .catch((error) => {
            // Clean up on error
            Promise.all([
              fs.unlink(tempVideoPath).catch(() => {}),
              fs.unlink(tempThumbnailPath).catch(() => {}),
            ]).finally(() => {
              reject(error);
            });
          });
      })
      .on("error", (error) => {
        mediaLogger.error({ err: serializeError(error) }, "FFmpeg error");
        // Clean up on error
        Promise.all([fs.unlink(tempVideoPath).catch(() => {}), fs.unlink(tempThumbnailPath).catch(() => {})]).finally(
          () => {
            reject(error);
          },
        );
      });
  });
}

/**
 * Generate a thumbnail for media (auto-detects type)
 * @param buffer - The media buffer
 * @param filename - Original filename
 * @param mimeType - MIME type of the file
 * @returns Thumbnail buffer and filename, or null if thumbnail generation fails
 */
export async function generateThumbnail(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ThumbnailResult | null> {
  try {
    if (mimeType.startsWith("image/")) {
      return await generateImageThumbnail(buffer, filename);
    } else if (mimeType.startsWith("video/")) {
      return await generateVideoThumbnail(buffer, filename);
    }
    return null;
  } catch (error) {
    mediaLogger.error({ err: serializeError(error), filename, mimeType }, "Failed to generate thumbnail");
    return null;
  }
}
