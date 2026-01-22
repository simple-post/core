import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_PHOTO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_CAPTION_LENGTH = 2200;
const MAX_PHOTO_CAPTION_LENGTH = 90;
const MAX_MEDIA_COUNT = 1;
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const MIN_FILE_SIZE_FOR_CHUNKING = 10 * 1024 * 1024; // Only chunk files larger than 10MB

const VALIDATION_RULES: PlatformValidationRules = {
  text: {
    maxCaptionLengthByMediaType: { video: MAX_VIDEO_CAPTION_LENGTH, image: MAX_PHOTO_CAPTION_LENGTH },
  },
  media: { requiresMedia: true, minCount: 1, maxCount: MAX_MEDIA_COUNT },
  video: { maxSizeBytes: MAX_VIDEO_SIZE },
  image: { maxSizeBytes: MAX_PHOTO_SIZE },
};

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

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;

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
  }

  private static getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size;
  }

  private static calculateChunks(fileSize: number): { chunkSize: number; totalChunks: number } {
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
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

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
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

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
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

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
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

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
    const fileSize = TikTokPublisher.getFileSize(filePath);
    const { chunkSize } = TikTokPublisher.calculateChunks(fileSize);
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

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    // Check for required media
    if (mediaCount === 0) {
      errors.push({
        platform: "tiktok",
        severity: "error",
        code: "media_required",
        message: "TikTok posts require at least one media item.",
        field: "media",
      });
    }

    // Check media sources
    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "tiktok",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    // Warn about excess media
    if (mediaCount > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "tiktok",
        severity: "warning",
        code: "too_many_media",
        message: "TikTok posts support only one media item in this SDK. Only the first media will be posted.",
        field: "media",
        limit: MAX_MEDIA_COUNT,
        actual: mediaCount,
      });
    }

    // Check caption length based on media type
    const primaryMedia = media[0];
    if (primaryMedia?.type === "video" && text.length > MAX_VIDEO_CAPTION_LENGTH) {
      errors.push({
        platform: "tiktok",
        severity: "error",
        code: "caption_too_long",
        message: `TikTok video captions cannot exceed ${MAX_VIDEO_CAPTION_LENGTH} characters.`,
        field: "text",
        limit: MAX_VIDEO_CAPTION_LENGTH,
        actual: text.length,
      });
    }

    if (primaryMedia?.type === "image" && text.length > MAX_PHOTO_CAPTION_LENGTH) {
      errors.push({
        platform: "tiktok",
        severity: "error",
        code: "caption_too_long",
        message: `TikTok photo captions cannot exceed ${MAX_PHOTO_CAPTION_LENGTH} characters.`,
        field: "text",
        limit: MAX_PHOTO_CAPTION_LENGTH,
        actual: text.length,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content
    const validation = TikTokPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "TikTok content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const tempFileManager = new TempFileManager();

    try {
      // Get the first media item (TikTok only supports single media)
      const media = content.media![0];

      // Resolve media path (download if URL)
      const { path: resolvedPath, cleanup, isTemp } = await resolveMediaPath(media);
      tempFileManager.add(cleanup);

      // Validate file size after download (for URLs)
      if (isTemp) {
        const fileSize = TikTokPublisher.getFileSize(resolvedPath);
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
      await tempFileManager.cleanup();
    }
  }
}
