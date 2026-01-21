import fs from "node:fs";
import path from "node:path";

import { v7 as uuidv7 } from "uuid";

import { downloadToTempFile } from "./media";
import { getPlatformRequirements } from "./platform-requirements";
import { S3MediaUploader } from "./s3";

import type { Media, Platform, Video } from "../types/post";

// ResolvedMedia is Media but ensures both path and url can be present
type ResolvedMedia = Media & {
  path?: string;
  url?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
};

interface CacheEntry {
  promise: Promise<string>;
  path?: string;
  refCount: number;
}

/**
 * MediaResolver handles efficient media resolution for multi-platform posting.
 * Uses promise-based caching to avoid duplicate downloads/uploads.
 */
export class MediaResolver {
  private downloadCache = new Map<string, CacheEntry>();
  private uploadCache = new Map<string, CacheEntry>();
  private s3Uploader: S3MediaUploader | null = null;
  private tempFiles: string[] = [];
  private s3Keys: string[] = [];

  /**
   * Gets or creates the S3 uploader (lazy initialization)
   */
  private getS3Uploader(): S3MediaUploader {
    if (!this.s3Uploader) {
      this.s3Uploader = new S3MediaUploader();
    }
    return this.s3Uploader;
  }

  /**
   * Downloads a URL to a temp file with promise-based caching
   */
  private async downloadUrl(url: string, preferredExtension?: string): Promise<string> {
    const existing = this.downloadCache.get(url);
    if (existing) {
      existing.refCount++;
      const path = await existing.promise;
      return path;
    }

    const entry: CacheEntry = {
      promise: downloadToTempFile(url, preferredExtension).then((downloadedPath) => {
        entry.path = downloadedPath;
        this.tempFiles.push(downloadedPath);
        return downloadedPath;
      }),
      refCount: 1,
    };

    this.downloadCache.set(url, entry);

    try {
      return await entry.promise;
    } catch (error) {
      // On failure, remove from cache so retry is possible
      this.downloadCache.delete(url);
      throw error;
    }
  }

  /**
   * Uploads a local file to S3/public storage with promise-based caching
   */
  private async uploadPath(filePath: string): Promise<string> {
    // Use file path + size as cache key to handle same file in different locations
    const stats = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;

    const existing = this.uploadCache.get(cacheKey);
    if (existing) {
      existing.refCount++;
      const url = await existing.promise;
      return url;
    }

    const key = `temp_${uuidv7()}_${path.basename(filePath)}`;
    const uploader = this.getS3Uploader();
    const entry: CacheEntry = {
      promise: uploader.uploadFile(filePath, key).then((url) => {
        entry.path = url;
        this.s3Keys.push(key);
        return url;
      }),
      refCount: 1,
    };

    this.uploadCache.set(cacheKey, entry);

    try {
      return await entry.promise;
    } catch (error) {
      // On failure, remove from cache
      this.uploadCache.delete(cacheKey);
      throw error;
    }
  }

  /**
   * Resolves media for the given platforms
   * Returns resolved media with both path and url set when needed
   */
  async resolve(media: Media[], platforms: Platform[]): Promise<ResolvedMedia[]> {
    const { needsPath, needsUrl, needsEither } = getPlatformRequirements(platforms);

    const resolved: ResolvedMedia[] = [];

    for (const item of media) {
      const resolvedItem: ResolvedMedia = { ...item };

      // Determine what we need based on platform requirements
      const needsFile = needsPath || (needsEither && !item.url);
      const needsPublicUrl = needsUrl || (needsEither && !item.path);

      // If media already has both, use as-is
      if (item.path && item.url) {
        resolvedItem.path = item.path;
        resolvedItem.url = item.url;
      } else {
        // Download URL to file if needed
        if (needsFile && item.url && !item.path) {
          const extension = item.type === "video" ? ".mp4" : ".jpg";
          resolvedItem.path = await this.downloadUrl(item.url, extension);
          resolvedItem.url = item.url; // Keep original URL
        } else if (item.path) {
          resolvedItem.path = item.path;
        } else if (item.url) {
          resolvedItem.url = item.url;
        }

        // Upload file to URL if needed
        if (needsPublicUrl && item.path && !item.url) {
          resolvedItem.url = await this.uploadPath(item.path);
          resolvedItem.path = item.path; // Keep original path
        } else if (item.url) {
          resolvedItem.url = item.url;
        }
      }

      // Handle video thumbnails
      if (item.type === "video") {
        const video = item as Video;
        if (video.thumbnailUrl && !video.thumbnailPath && needsFile) {
          // Download thumbnail if we need file and have URL
          resolvedItem.thumbnailPath = await this.downloadUrl(video.thumbnailUrl, ".jpg");
          resolvedItem.thumbnailUrl = video.thumbnailUrl;
        } else if (video.thumbnailPath && !video.thumbnailUrl && needsPublicUrl) {
          // Upload thumbnail if we need URL and have path
          resolvedItem.thumbnailUrl = await this.uploadPath(video.thumbnailPath);
          resolvedItem.thumbnailPath = video.thumbnailPath;
        } else {
          // Keep existing thumbnail
          if (video.thumbnailPath) resolvedItem.thumbnailPath = video.thumbnailPath;
          if (video.thumbnailUrl) resolvedItem.thumbnailUrl = video.thumbnailUrl;
        }
      }

      resolved.push(resolvedItem);
    }

    return resolved;
  }

  /**
   * Releases a cached download (decrements ref count)
   */
  private releaseDownload(url: string): void {
    const entry = this.downloadCache.get(url);
    if (entry) {
      entry.refCount--;
      if (entry.refCount === 0) {
        this.downloadCache.delete(url);
      }
    }
  }

  /**
   * Releases a cached upload (decrements ref count)
   */
  private releaseUpload(cacheKey: string): void {
    const entry = this.uploadCache.get(cacheKey);
    if (entry) {
      entry.refCount--;
      if (entry.refCount === 0) {
        this.uploadCache.delete(cacheKey);
      }
    }
  }

  /**
   * Cleans up all temporary files and S3 uploads
   */
  async cleanup(): Promise<void> {
    // Delete temp files
    for (const filePath of this.tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.tempFiles = [];

    // Delete S3 uploads
    if (this.s3Uploader) {
      for (const key of this.s3Keys) {
        try {
          await this.s3Uploader.deleteFile(key);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    this.s3Keys = [];

    // Clear caches
    this.downloadCache.clear();
    this.uploadCache.clear();
  }
}
