"use client";

/**
 * Client-side thumbnail generation utilities
 * Uses Canvas API for images and video element for video frame capture
 */

import { logClientError } from "@/lib/logger/client";

const THUMBNAIL_SIZE = 400;
const THUMBNAIL_QUALITY = 0.8;

/**
 * Generate a thumbnail for an image file
 * @param file - The image file
 * @returns A Blob containing the thumbnail as JPEG
 */
export async function generateImageThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.addEventListener("load", () => {
      URL.revokeObjectURL(url);

      // Calculate dimensions to fit within THUMBNAIL_SIZE while maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > THUMBNAIL_SIZE) {
          height = Math.round((height * THUMBNAIL_SIZE) / width);
          width = THUMBNAIL_SIZE;
        }
      } else {
        if (height > THUMBNAIL_SIZE) {
          width = Math.round((width * THUMBNAIL_SIZE) / height);
          height = THUMBNAIL_SIZE;
        }
      }

      // Create canvas and draw scaled image
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to generate thumbnail blob"));
          }
        },
        "image/jpeg",
        THUMBNAIL_QUALITY,
      );
    });

    img.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for thumbnail generation"));
    });

    img.src = url;
  });
}

/**
 * Generate a thumbnail for a video file by capturing a frame
 * @param file - The video file
 * @param captureTime - Time in seconds to capture the frame (default: 1)
 * @returns A Blob containing the thumbnail as JPEG
 */
export async function generateVideoThumbnail(file: File, captureTime: number = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.addEventListener("loadedmetadata", () => {
      // Seek to the capture time, but not beyond video duration
      const seekTime = Math.min(captureTime, video.duration - 0.1);
      video.currentTime = Math.max(0, seekTime);
    });

    video.addEventListener("seeked", () => {
      // Calculate dimensions to fit within THUMBNAIL_SIZE while maintaining aspect ratio
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > height) {
        if (width > THUMBNAIL_SIZE) {
          height = Math.round((height * THUMBNAIL_SIZE) / width);
          width = THUMBNAIL_SIZE;
        }
      } else {
        if (height > THUMBNAIL_SIZE) {
          width = Math.round((width * THUMBNAIL_SIZE) / height);
          height = THUMBNAIL_SIZE;
        }
      }

      // Create canvas and draw video frame
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(video, 0, 0, width, height);
      URL.revokeObjectURL(url);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to generate thumbnail blob"));
          }
        },
        "image/jpeg",
        THUMBNAIL_QUALITY,
      );
    });

    video.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video for thumbnail generation"));
    });

    video.src = url;
  });
}

/**
 * Generate a thumbnail for a media file (auto-detects type)
 * @param file - The media file
 * @returns A Blob containing the thumbnail as JPEG, or null if generation fails
 */
export async function generateThumbnail(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith("image/")) {
      return await generateImageThumbnail(file);
    } else if (file.type.startsWith("video/")) {
      return await generateVideoThumbnail(file);
    }
    return null;
  } catch (error) {
    logClientError(error, "Failed to generate thumbnail", {
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });
    return null;
  }
}
