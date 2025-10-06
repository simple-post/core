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
  return new Promise(async (resolve, reject) => {
    const fs = await import("fs/promises");
    const tempVideoFilename = `temp-video-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
    const tempVideoPath = `/tmp/${tempVideoFilename}`;
    const tempThumbnailFilename = `temp-thumbnail-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    const tempThumbnailPath = `/tmp/${tempThumbnailFilename}`;

    try {
      // Write video buffer to a temporary file (ffmpeg needs a file, not a stream)
      await fs.writeFile(tempVideoPath, buffer);

      ffmpeg(tempVideoPath)
        .screenshots({
          count: 1,
          folder: "/tmp",
          filename: tempThumbnailFilename,
          size: "400x?",
          timestamps: ["00:00:01"], // Extract frame at 1 second
        })
        .on("end", async () => {
          try {
            // Read the generated thumbnail
            const thumbnailBuffer = await fs.readFile(tempThumbnailPath);

            // Clean up temp files
            await fs.unlink(tempVideoPath).catch(() => {});
            await fs.unlink(tempThumbnailPath).catch(() => {});

            const nameWithoutExt = filename.substring(0, filename.lastIndexOf("."));
            const thumbnailFilename = `${nameWithoutExt}_thumb.jpg`;

            resolve({
              buffer: thumbnailBuffer,
              filename: thumbnailFilename,
            });
          } catch (error) {
            // Clean up on error
            await fs.unlink(tempVideoPath).catch(() => {});
            await fs.unlink(tempThumbnailPath).catch(() => {});
            reject(error);
          }
        })
        .on("error", async (error) => {
          console.error("FFmpeg error:", error);
          // Clean up on error
          await fs.unlink(tempVideoPath).catch(() => {});
          await fs.unlink(tempThumbnailPath).catch(() => {});
          reject(error);
        });
    } catch (error) {
      console.error("Video thumbnail generation error:", error);
      // Clean up on error
      await fs.unlink(tempVideoPath).catch(() => {});
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
