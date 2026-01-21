import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { AxiosInstance } from "axios";

const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_PHOTO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_CAPTION_LENGTH = 150;
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const MIN_FILE_SIZE_FOR_CHUNKING = 10 * 1024 * 1024; // Only chunk files larger than 10MB

interface TikTokUploadInitResponse {
  data: {
    publish_id: string;
    upload_url: string;
  };
}

interface TikTokInboxUploadInitResponse {
  data: {
    upload_url: string;
  };
}

export class TikTokPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

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
    // For files smaller than the chunking threshold, upload as a single chunk
    if (fileSize <= MIN_FILE_SIZE_FOR_CHUNKING) {
      return { chunkSize: fileSize, totalChunks: 1 };
    }

    // For larger files, use fixed chunk size
    const chunkSize = CHUNK_SIZE;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    return { chunkSize, totalChunks };
  }

  private async initVideoUploadDirect(
    media: Media,
    resolvedPath: string,
    content: Content,
    options?: PostOptionsWithCredentials,
  ): Promise<TikTokUploadInitResponse> {
    const fileSize = this.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      // Use Direct Post API - includes post_info in the init request for immediate publishing
      // Priority: media.title > content.text for title
      // TikTok doesn't support separate description field, so combine title + description if both exist
      let title = "";
      if (media.type === "video") {
        if (media.title) {
          title = media.title;
          // If description is also provided, append it to the title (TikTok only has one text field)
          if (media.description) {
            title = `${media.title}\n\n${media.description}`;
          }
        } else {
          title = content.text || "";
        }
      } else {
        title = content.text || "";
      }

      const response = await this.client.post<TikTokUploadInitResponse>("/v2/post/publish/video/init/", {
        post_info: {
          title,
          privacy_level: this.mapVisibilityToPrivacyLevel(options?.tiktok?.visibility),
          disable_comment: !(options?.tiktok?.allowComment ?? true),
          disable_duet: !(options?.tiktok?.allowDuet ?? true),
          disable_stitch: !(options?.tiktok?.allowStitch ?? true),
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
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
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = error.response?.data?.error?.message || error.message;

      // Provide helpful context for common errors
      if (errorCode === "unaudited_client_can_only_post_to_private_accounts") {
        throw new PostError(
          PostErrorType.API_ERROR,
          `TikTok API Error: Unaudited apps can only post to private accounts. Please set your TikTok account to private in the TikTok app settings (Settings → Privacy → Private Account), or get your app audited at https://developers.tiktok.com/doc/content-sharing-guidelines/`,
          error,
        );
      }

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize video upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        error,
      );
    }
  }

  private async initVideoUploadDraft(resolvedPath: string): Promise<TikTokInboxUploadInitResponse> {
    const fileSize = this.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      // Use Upload Video API (inbox) - for draft uploads
      const response = await this.client.post<TikTokInboxUploadInitResponse>("/v2/post/publish/inbox/video/init/", {
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
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = error.response?.data?.error?.message || error.message;

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize draft video upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        error,
      );
    }
  }

  private async initPhotoUploadDirect(
    media: Media,
    resolvedPath: string,
    content: Content,
    options?: PostOptionsWithCredentials,
  ): Promise<TikTokUploadInitResponse> {
    const fileSize = this.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      // Use Direct Post API for photos - includes post_info in the init request for immediate publishing
      // Priority: media.caption > content.text for title
      const title = (media.type === "image" ? media.caption : undefined) || content.text || "";

      const response = await this.client.post<TikTokUploadInitResponse>("/v2/post/publish/photo/init/", {
        post_info: {
          title,
          privacy_level: this.mapVisibilityToPrivacyLevel(options?.tiktok?.visibility),
          disable_comment: !(options?.tiktok?.allowComment ?? true),
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
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
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = error.response?.data?.error?.message || error.message;

      // Provide helpful context for common errors
      if (errorCode === "unaudited_client_can_only_post_to_private_accounts") {
        throw new PostError(
          PostErrorType.API_ERROR,
          `TikTok API Error: Unaudited apps can only post to private accounts. Please set your TikTok account to private in the TikTok app settings (Settings → Privacy → Private Account), or get your app audited at https://developers.tiktok.com/doc/content-sharing-guidelines/`,
          error,
        );
      }

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize photo upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        error,
      );
    }
  }

  private async initPhotoUploadDraft(resolvedPath: string): Promise<TikTokInboxUploadInitResponse> {
    const fileSize = this.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = this.calculateChunks(fileSize);

    try {
      // Use Upload Photo API (inbox) - for draft uploads
      const response = await this.client.post<TikTokInboxUploadInitResponse>("/v2/post/publish/inbox/photo/init/", {
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
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = error.response?.data?.error?.message || error.message;

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize draft photo upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        error,
      );
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

  private async uploadMedia(
    media: Media,
    resolvedPath: string,
    content: Content,
    options?: PostOptionsWithCredentials,
  ): Promise<string> {
    const isDraft = options?.tiktok?.publishMode === "draft";

    if (isDraft) {
      // Use Upload Video/Photo API (inbox) for draft mode
      const initResponse = await (media.type === "video"
        ? this.initVideoUploadDraft(resolvedPath)
        : this.initPhotoUploadDraft(resolvedPath));

      // Upload the file to TikTok servers
      await this.uploadFileChunks(initResponse.data.upload_url, resolvedPath);

      // For draft mode, the content goes to inbox - return a placeholder ID
      // Note: TikTok doesn't provide a publish_id for draft uploads
      return "draft_uploaded";
    } else {
      // Use Direct Post API for immediate publishing
      const initResponse = await (media.type === "video"
        ? this.initVideoUploadDirect(media, resolvedPath, content, options)
        : this.initPhotoUploadDirect(media, resolvedPath, content, options));

      // Upload the file to TikTok servers
      await this.uploadFileChunks(initResponse.data.upload_url, resolvedPath);

      // With Direct Post API, the content is automatically published after upload
      // Return the publish_id for status tracking
      return initResponse.data.publish_id;
    }
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

    // Validate media has a valid source (path or url)
    if (!hasValidSource(media)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media must have either a path or url");
    }

    // If path is provided, validate the file exists and size
    if (media.path) {
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
        this.strictCheck(
          fileSize > MAX_PHOTO_SIZE,
          `Photo file size cannot exceed ${MAX_PHOTO_SIZE / (1024 * 1024)}MB.`,
        );
      }
    }
    // Note: File size validation for URLs happens after download in postContent()

    // Caption length validation
    this.strictCheck(
      Boolean(content.text && content.text.length > MAX_CAPTION_LENGTH),
      `TikTok caption cannot exceed ${MAX_CAPTION_LENGTH} characters.`,
    );
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content
    this.validate(content);

    const tempFileManager = new TempFileManager();

    try {
      // Get the first media item (TikTok only supports single media)
      const media = content.media![0];

      // Resolve media path (download if URL)
      const { path: resolvedPath, cleanup, isTemp } = await resolveMediaPath(media);
      tempFileManager.add(cleanup);

      // Validate file size after download (for URLs)
      if (isTemp) {
        const fileSize = this.getFileSize(resolvedPath);
        if (media.type === "video" && fileSize > MAX_VIDEO_SIZE) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            `Video file size (${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB) exceeds maximum allowed size of ${MAX_VIDEO_SIZE / (1024 * 1024 * 1024)}GB.`,
          );
        }
        if (media.type === "image" && fileSize > MAX_PHOTO_SIZE) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            `Photo file size (${(fileSize / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_PHOTO_SIZE / (1024 * 1024)}MB.`,
          );
        }
      }

      // Upload the media - uses Direct Post API for immediate publishing or Upload API for drafts
      // Based on options.tiktok.publishMode: "draft" goes to inbox, otherwise publishes immediately
      const publishId = await this.uploadMedia(media, resolvedPath, content, options);

      return { id: publishId, error: PostErrorType.NO_ERROR };
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
      await tempFileManager.cleanup();
    }
  }
}
