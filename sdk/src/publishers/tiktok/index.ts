import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { AxiosInstance } from "axios";

const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_PHOTO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_CAPTION_LENGTH = 150;
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

interface TikTokUploadInitResponse {
  data: {
    upload_url: string;
    upload_id: string;
  };
}

interface TikTokUploadCompleteResponse {
  data: {
    publish_id: string;
  };
}

export class TikTokPublisher extends Publisher {
  private client: AxiosInstance;

  private s3MediaUploader: S3MediaUploader;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptionsWithCredentials) {
    super("TikTok", options);

    // Validate the credentials
    if (!options?.tiktok?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "TikTok credentials are required in options.tiktok.credentials",
      );
    }

    const { accessToken } = options.tiktok.credentials;

    // Create axios client with base configuration
    this.client = axios.create({
      baseURL: "https://open.tiktokapis.com",
      timeout: 60_000, // 60 seconds timeout for uploads
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // Create S3 media uploader
    this.s3MediaUploader = new S3MediaUploader();
  }

  private async cleanupS3Files(): Promise<void> {
    await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader.deleteFile(key)));
  }

  private getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size;
  }

  private calculateChunks(fileSize: number): { chunkSize: number; totalChunks: number } {
    const chunkSize = Math.min(CHUNK_SIZE, fileSize);
    const totalChunks = Math.ceil(fileSize / chunkSize);
    return { chunkSize, totalChunks };
  }

  private async initVideoUpload(media: Media): Promise<TikTokUploadInitResponse> {
    const fileSize = this.getFileSize(media.path);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      const response = await this.client.post<TikTokUploadInitResponse>("/v2/post/publish/inbox/video/init/", {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: fileSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      });

      return response.data;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to initialize video upload: ${error.message}`, error);
    }
  }

  private async initPhotoUpload(media: Media): Promise<TikTokUploadInitResponse> {
    const fileSize = this.getFileSize(media.path);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      const response = await this.client.post<TikTokUploadInitResponse>("/v2/post/publish/inbox/photo/init/", {
        source_info: {
          source: "FILE_UPLOAD",
          photo_size: fileSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      });

      return response.data;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to initialize photo upload: ${error.message}`, error);
    }
  }

  private async uploadFileChunks(uploadUrl: string, filePath: string): Promise<void> {
    const fileSize = this.getFileSize(filePath);
    const { chunkSize } = this.calculateChunks(fileSize);
    const fileStream = fs.createReadStream(filePath);
    const chunks: Buffer[] = [];

    // Read file into chunks
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    let uploadedBytes = 0;

    while (uploadedBytes < fileSize) {
      const start = uploadedBytes;
      const end = Math.min(uploadedBytes + chunkSize - 1, fileSize - 1);
      const chunkData = buffer.subarray(start, end + 1);

      try {
        await axios.put(uploadUrl, chunkData, {
          headers: {
            "Content-Type": path.extname(filePath) === ".mp4" ? "video/mp4" : "image/jpeg",
            "Content-Length": chunkData.length.toString(),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          },
          timeout: 30_000,
        });

        uploadedBytes = end + 1;
        this.logger.info(`Uploaded ${uploadedBytes}/${fileSize} bytes`);
      } catch (error: any) {
        this.logger.error(error);
        throw new PostError(PostErrorType.API_ERROR, `Failed to upload chunk: ${error.message}`, error);
      }
    }
  }

  private async completeVideoUpload(uploadId: string): Promise<TikTokUploadCompleteResponse> {
    try {
      const response = await this.client.post<TikTokUploadCompleteResponse>("/v2/post/publish/inbox/video/complete/", {
        upload_id: uploadId,
      });

      return response.data;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to complete video upload: ${error.message}`, error);
    }
  }

  private async completePhotoUpload(uploadId: string): Promise<TikTokUploadCompleteResponse> {
    try {
      const response = await this.client.post<TikTokUploadCompleteResponse>("/v2/post/publish/inbox/photo/complete/", {
        upload_id: uploadId,
      });

      return response.data;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to complete photo upload: ${error.message}`, error);
    }
  }

  private async publishContent(
    publishId: string,
    content: Content,
    options?: PostOptionsWithCredentials,
  ): Promise<string> {
    try {
      const publishPayload = {
        publish_id: publishId,
        text: content.text || "",
        privacy_level: this.mapVisibilityToPrivacyLevel(options?.tiktok?.visibility),
        disable_comment: !(options?.tiktok?.allowComment ?? true),
        disable_duet: !(options?.tiktok?.allowDuet ?? true),
        disable_stitch: !(options?.tiktok?.allowStitch ?? true),
        brand_content_toggle: false,
        brand_organic_toggle: false,
      };

      const endpoint =
        options?.tiktok?.publishMode === "draft" ? "/v2/post/publish/content/draft/" : "/v2/post/publish/content/";

      const response = await this.client.post(endpoint, publishPayload);

      return response.data.share_id || response.data.id || publishId;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to publish content: ${error.message}`, error);
    }
  }

  private mapVisibilityToPrivacyLevel(visibility?: string): string {
    switch (visibility) {
      case "public": {
        return "PUBLIC_TO_EVERYONE";
      }
      case "friends": {
        return "MUTUAL_FOLLOW_FRIENDS";
      }
      case "private": {
        return "SELF_ONLY";
      }
      default: {
        return "PUBLIC_TO_EVERYONE";
      }
    }
  }

  private async uploadMedia(media: Media): Promise<string> {
    // Initialize upload based on media type
    const initResponse = await (media.type === "video" ? this.initVideoUpload(media) : this.initPhotoUpload(media));

    // Upload the file
    await this.uploadFileChunks(initResponse.data.upload_url, media.path);

    // Complete upload based on media type
    const completeResponse = await (media.type === "video"
      ? this.completeVideoUpload(initResponse.data.upload_id)
      : this.completePhotoUpload(initResponse.data.upload_id));

    return completeResponse.data.publish_id;
  }

  private validate(content: Content): void {
    if (!content.media || content.media.length === 0) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "TikTok posts require at least one media item (image or video).",
      );
    }

    // TikTok only supports single media per post
    if (content.media.length > 1) {
      // For slideshows, we'll only use the first image
      this.strictCheck(
        content.media.length > 1 && content.media.every((m) => m.type === "image"),
        "TikTok only supports single media per post. For slideshows, only the first image will be used.",
      );
    }

    const media = content.media[0];

    // Validate each media file exists
    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
    }

    // Validate file size
    const fileSize = this.getFileSize(media.path);
    if (media.type === "video") {
      this.strictCheck(
        fileSize > MAX_VIDEO_SIZE,
        `Video file size cannot exceed ${MAX_VIDEO_SIZE / (1024 * 1024 * 1024)}GB.`,
      );
    } else {
      this.strictCheck(fileSize > MAX_PHOTO_SIZE, `Photo file size cannot exceed ${MAX_PHOTO_SIZE / (1024 * 1024)}MB.`);
    }

    // Caption length validation
    this.strictCheck(
      Boolean(content.text && content.text.length > MAX_CAPTION_LENGTH),
      `TikTok caption cannot exceed ${MAX_CAPTION_LENGTH} characters.`,
    );
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content
    this.validate(content);

    try {
      // Get the first media item (TikTok only supports single media)
      const media = content.media![0];

      // Upload the media
      const publishId = await this.uploadMedia(media);

      // Publish or save as draft
      const finalId = await this.publishContent(publishId, content, options);

      return { id: finalId, error: PostErrorType.NO_ERROR };
    } catch (error: any) {
      if (error instanceof PostError) throw error;

      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish TikTok post: ${error.response?.data?.error?.message || error.message}`,
        error,
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
