import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { execSync } from "child_process";

// Try to find ffmpeg on the system PATH
function getFFmpegPath(): string {
  try {
    // First, try to use system ffmpeg
    const ffmpegPath = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (ffmpegPath) {
      return ffmpegPath;
    }
  } catch (error) {
    // If system ffmpeg not found, try the installer package
    try {
      const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
      return ffmpegInstaller.path;
    } catch {
      throw new Error(
        "FFmpeg not found. Please install FFmpeg on your system or ensure @ffmpeg-installer/ffmpeg is properly installed.",
      );
    }
  }
  throw new Error("FFmpeg not found");
}

// Set the ffmpeg path
try {
  const ffmpegPath = getFFmpegPath();
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log(`Using FFmpeg at: ${ffmpegPath}`);
} catch (error) {
  console.error("FFmpeg setup error:", error);
}

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

  const ext = filename.split(".").pop();
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf("."));
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
  return new Promise((resolve, reject) => {
    try {
      const stream = Readable.from(buffer);
      const tempFilename = `temp-thumbnail-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
      const tempPath = `/tmp/${tempFilename}`;

      ffmpeg(stream)
        .screenshots({
          count: 1,
          folder: "/tmp",
          filename: tempFilename,
          size: "400x?",
        })
        .on("end", async () => {
          try {
            // Read the generated thumbnail
            const fs = await import("fs/promises");
            const thumbnailBuffer = await fs.readFile(tempPath);

            // Clean up temp file
            await fs.unlink(tempPath).catch(() => {});

            const nameWithoutExt = filename.substring(0, filename.lastIndexOf("."));
            const thumbnailFilename = `${nameWithoutExt}_thumb.jpg`;

            resolve({
              buffer: thumbnailBuffer,
              filename: thumbnailFilename,
            });
          } catch (error) {
            reject(error);
          }
        })
        .on("error", (error) => {
          console.error("FFmpeg error:", error);
          reject(error);
        });
    } catch (error) {
      console.error("Video thumbnail generation error:", error);
      reject(error);
    }
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
    console.error("Failed to generate thumbnail:", error);
    return null;
  }
}
