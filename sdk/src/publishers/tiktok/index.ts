import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import {
  TIKTOK_MAX_PHOTO_SIZE,
  TIKTOK_MAX_VIDEO_SIZE,
  TIKTOK_VALIDATION_RULES,
  validateTikTokContent,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials, TikTokPrivacyLevel } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const MIN_FILE_SIZE_FOR_CHUNKING = 10 * 1024 * 1024; // Only chunk files larger than 10MB
// TikTok's Direct Post API returns a `publish_id` immediately, but the actual
// public video ID is only known once processing finishes. We poll the status
// endpoint until PUBLISH_COMPLETE so callers can link to the real video.
// Video processing can take 1–2 minutes for larger files, so we budget ~3 min.
const PUBLISH_STATUS_POLL_INTERVAL_MS = 3000;
const PUBLISH_STATUS_MAX_ATTEMPTS = 60; // ~3 minutes total

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

interface TikTokPublishStatusResponse {
  data: {
    status: string;
    fail_reason?: string;
    publicaly_available_post_id?: Array<string | number>;
    publicly_available_post_id?: Array<string | number>;
  };
  error?: { code?: string; message?: string };
}

interface TikTokCreatorInfoResponse {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: TikTokPrivacyLevel[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: { code?: string; message?: string; log_id?: string; logid?: string };
}

type TikTokCreatorInfo = NonNullable<TikTokCreatorInfoResponse["data"]>;

export class TikTokPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return TIKTOK_VALIDATION_RULES;
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

  private static creatorInfoErrorMessage(code?: string, message?: string): string {
    switch (code) {
      case "spam_risk_too_many_posts": {
        return "TikTok says this creator has reached their daily post cap. Please try again later.";
      }
      case "spam_risk_user_banned_from_posting": {
        return "TikTok says this creator cannot make posts right now.";
      }
      case "reached_active_user_cap": {
        return "TikTok says this app has reached its active creator cap for today. Please try again later.";
      }
      case "access_token_invalid": {
        return "TikTok access token is invalid or expired. Please reconnect the TikTok account.";
      }
      case "scope_not_authorized": {
        return "TikTok did not grant the video.publish scope required for direct posting.";
      }
      case "rate_limit_exceeded": {
        return "TikTok creator info rate limit was exceeded. Please try again later.";
      }
      default: {
        return message || "TikTok creator info request failed.";
      }
    }
  }

  private async queryCreatorInfo(): Promise<TikTokCreatorInfo> {
    try {
      const response = await this.client.post<TikTokCreatorInfoResponse>("/v2/post/publish/creator_info/query/");
      const errorCode = response.data?.error?.code;
      if (errorCode && errorCode !== "ok") {
        throw new PostError(
          PostErrorType.API_ERROR,
          TikTokPublisher.creatorInfoErrorMessage(errorCode, response.data.error?.message),
          response.data.error,
        );
      }
      if (!response.data?.data) {
        throw new PostError(PostErrorType.API_ERROR, "TikTok creator info response did not include creator data.");
      }
      return response.data.data;
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      const errorCode = err.response?.data?.error?.code;
      const errorMessage = TikTokPublisher.creatorInfoErrorMessage(
        errorCode,
        err.response?.data?.error?.message || err.message,
      );
      throw new PostError(PostErrorType.API_ERROR, errorMessage, err);
    }
  }

  private resolvePrivacyLevel(options?: PostOptionsWithCredentials): TikTokPrivacyLevel | undefined {
    const privacyLevel = options?.tiktok?.privacyLevel;
    if (privacyLevel) {
      return privacyLevel;
    }

    return this.mapVisibilityToPrivacyLevel(options?.tiktok?.visibility);
  }

  private async validateDirectPostRequirements(
    media: Media,
    options?: PostOptionsWithCredentials,
  ): Promise<TikTokPrivacyLevel> {
    const creatorInfo = await this.queryCreatorInfo();
    const privacyLevel = this.resolvePrivacyLevel(options);

    if (!privacyLevel) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "TikTok Direct Post requires a manually selected privacy status from the creator info options.",
      );
    }

    const privacyOptions = creatorInfo.privacy_level_options ?? [];
    if (!privacyOptions.includes(privacyLevel)) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `TikTok privacy status ${privacyLevel} is not available for this creator.`,
        { privacyLevel, privacyOptions },
      );
    }

    if (
      media.type === "video" &&
      typeof media.durationSec === "number" &&
      typeof creatorInfo.max_video_post_duration_sec === "number" &&
      media.durationSec > creatorInfo.max_video_post_duration_sec
    ) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `TikTok video duration (${Math.ceil(media.durationSec)}s) exceeds this creator's ${creatorInfo.max_video_post_duration_sec}s limit.`,
        { durationSec: media.durationSec, maxVideoPostDurationSec: creatorInfo.max_video_post_duration_sec },
      );
    }

    if (options?.tiktok?.allowComment === true && creatorInfo.comment_disabled) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "TikTok comments are disabled by this creator's settings.");
    }
    if (media.type === "video" && options?.tiktok?.allowDuet === true && creatorInfo.duet_disabled) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "TikTok Duet is disabled by this creator's settings.");
    }
    if (media.type === "video" && options?.tiktok?.allowStitch === true && creatorInfo.stitch_disabled) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "TikTok Stitch is disabled by this creator's settings.");
    }

    return privacyLevel;
  }

  private async initVideoUploadDirect(
    media: Media,
    resolvedPath: string,
    content: Content,
    privacyLevel: TikTokPrivacyLevel,
    options?: PostOptionsWithCredentials,
  ): Promise<TikTokUploadInitResponse> {
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

    try {
      // Use Direct Post API - includes post_info in the init request for immediate publishing
      // Priority: media.title > content.text for title
      // TikTok doesn't support separate description field, so combine title + description if both exist
      let title = "";
      if (options?.tiktok?.title !== undefined) {
        title = options.tiktok.title;
      } else if (media.type === "video") {
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
          privacy_level: privacyLevel,
          disable_comment: options?.tiktok?.allowComment !== true,
          disable_duet: options?.tiktok?.allowDuet !== true,
          disable_stitch: options?.tiktok?.allowStitch !== true,
          brand_content_toggle: options?.tiktok?.discloseBrandedContent === true,
          brand_organic_toggle: options?.tiktok?.discloseYourBrand === true,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: fileSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      });

      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      const errorCode = err.response?.data?.error?.code;
      const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error";

      // Provide helpful context for common errors
      if (errorCode === "unaudited_client_can_only_post_to_private_accounts") {
        throw new PostError(
          PostErrorType.API_ERROR,
          `TikTok API Error: Unaudited apps can only post to private accounts. Please set your TikTok account to private in the TikTok app settings (Settings → Privacy → Private Account), or get your app audited at https://developers.tiktok.com/doc/content-sharing-guidelines/`,
          err,
        );
      }

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize video upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        err,
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
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      const errorCode = err.response?.data?.error?.code;
      const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error";

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize draft video upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        err,
      );
    }
  }

  private async initPhotoUploadDirect(
    media: Media,
    resolvedPath: string,
    content: Content,
    privacyLevel: TikTokPrivacyLevel,
    options?: PostOptionsWithCredentials,
  ): Promise<TikTokUploadInitResponse> {
    const fileSize = TikTokPublisher.getFileSize(resolvedPath);
    const { chunkSize, totalChunks } = TikTokPublisher.calculateChunks(fileSize);

    try {
      // Use Direct Post API for photos - includes post_info in the init request for immediate publishing
      // Priority: media.caption > content.text for title
      const title =
        options?.tiktok?.title ?? (media.type === "image" ? media.caption : undefined) ?? content.text ?? "";

      const response = await this.client.post<TikTokUploadInitResponse>("/v2/post/publish/photo/init/", {
        post_info: {
          title,
          privacy_level: privacyLevel,
          disable_comment: options?.tiktok?.allowComment !== true,
          brand_content_toggle: options?.tiktok?.discloseBrandedContent === true,
          brand_organic_toggle: options?.tiktok?.discloseYourBrand === true,
        },
        source_info: {
          source: "FILE_UPLOAD",
          photo_size: fileSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      });

      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      const errorCode = err.response?.data?.error?.code;
      const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error";

      // Provide helpful context for common errors
      if (errorCode === "unaudited_client_can_only_post_to_private_accounts") {
        throw new PostError(
          PostErrorType.API_ERROR,
          `TikTok API Error: Unaudited apps can only post to private accounts. Please set your TikTok account to private in the TikTok app settings (Settings → Privacy → Private Account), or get your app audited at https://developers.tiktok.com/doc/content-sharing-guidelines/`,
          err,
        );
      }

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize photo upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        err,
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
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      const errorCode = err.response?.data?.error?.code;
      const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error";

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to initialize draft photo upload: ${errorMessage} (code: ${errorCode || "unknown"})`,
        err,
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
      } catch (error: unknown) {
        const err = error as { message?: string };
        this.logger.error(error instanceof Error ? error : String(error));
        throw new PostError(PostErrorType.API_ERROR, `Failed to upload chunk: ${err.message || "Unknown error"}`, err);
      }
    }
  }

  /**
   * Polls the TikTok publish status endpoint until the post is fully
   * published, returning the public-facing video ID once available.
   *
   * Direct Post initially returns only a `publish_id` (an internal job id).
   * The numeric video id required to build a `tiktok.com/@user/video/...`
   * URL is only emitted via this status endpoint once processing finishes.
   *
   * @returns the public post ID when status is PUBLISH_COMPLETE,
   *          or `undefined` if it can't be resolved within the budget.
   */
  private async pollPublishStatus(publishId: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < PUBLISH_STATUS_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.client.post<TikTokPublishStatusResponse>("/v2/post/publish/status/fetch/", {
          publish_id: publishId,
        });

        const data = response.data?.data;
        const status = data?.status;
        this.logger.info(
          `TikTok publish status (attempt ${attempt + 1}/${PUBLISH_STATUS_MAX_ATTEMPTS}): ${status ?? "unknown"}`,
        );

        if (status === "PUBLISH_COMPLETE") {
          // TikTok's API documents the field as `publicaly_available_post_id`
          // (note the typo), but accept the corrected form too in case it
          // ever changes.
          const publicIds = data?.publicaly_available_post_id ?? data?.publicly_available_post_id;
          const publicId = publicIds?.[0];
          if (publicId !== undefined && publicId !== null) {
            return String(publicId);
          }
          return undefined;
        }

        if (status === "FAILED") {
          this.logger.warn(`TikTok publish failed during processing: ${data?.fail_reason || "unknown"}`);
          return undefined;
        }

        // Unaudited apps cannot publish directly — TikTok routes the post to
        // the creator's inbox for them to manually finish publishing. There
        // is no public video id at this point, so stop polling.
        if (status === "SEND_TO_USER_INBOX") {
          this.logger.info("TikTok post sent to user inbox; no public video id available yet");
          return undefined;
        }
      } catch (error) {
        const err = error as { message?: string };
        this.logger.warn(`TikTok publish status poll failed (attempt ${attempt + 1}): ${err.message || String(error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, PUBLISH_STATUS_POLL_INTERVAL_MS));
    }

    this.logger.warn(
      `TikTok publish status did not reach PUBLISH_COMPLETE within ${PUBLISH_STATUS_MAX_ATTEMPTS} attempts`,
    );
    return undefined;
  }

  private mapVisibilityToPrivacyLevel(visibility?: string): TikTokPrivacyLevel | undefined {
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
        return undefined;
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
      const privacyLevel = await this.validateDirectPostRequirements(media, options);

      // Use Direct Post API for immediate publishing
      const initResponse = await (media.type === "video"
        ? this.initVideoUploadDirect(media, resolvedPath, content, privacyLevel, options)
        : this.initPhotoUploadDirect(media, resolvedPath, content, privacyLevel, options));

      // Upload the file to TikTok servers
      await this.uploadFileChunks(initResponse.data.upload_url, resolvedPath);

      // With Direct Post API, the content is automatically published after upload
      // Return the publish_id for status tracking
      return initResponse.data.publish_id;
    }
  }

  static validate(content: Content): ValidationResult {
    return validateTikTokContent(content);
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
        if (media.type === "video" && fileSize > TIKTOK_MAX_VIDEO_SIZE) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            `Video file size (${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB) exceeds maximum allowed size of ${TIKTOK_MAX_VIDEO_SIZE / (1024 * 1024 * 1024)}GB.`,
          );
        }
        if (media.type === "image" && fileSize > TIKTOK_MAX_PHOTO_SIZE) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            `Photo file size (${(fileSize / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${TIKTOK_MAX_PHOTO_SIZE / (1024 * 1024)}MB.`,
          );
        }
      }

      // Upload the media - uses Direct Post API for immediate publishing or Upload API for drafts
      // Based on options.tiktok.publishMode: "draft" goes to inbox, otherwise publishes immediately
      const publishId = await this.uploadMedia(media, resolvedPath, content, options);
      const isDraft = options?.tiktok?.publishMode === "draft";

      // For direct posts, the publish_id is an internal job id — the actual
      // public video id (used in the post URL) is only available after
      // processing completes. Poll the status endpoint to resolve it.
      if (!isDraft) {
        const publicPostId = await this.pollPublishStatus(publishId);
        if (publicPostId) {
          return { id: publicPostId, error: PostErrorType.NO_ERROR };
        }
        this.logger.warn(
          `TikTok publish for ${publishId} did not yield a public post id in time; falling back to publish_id`,
        );
      }

      return { id: publishId, error: PostErrorType.NO_ERROR };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };

      this.logger.error(error instanceof Error ? error : String(error));

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish TikTok post: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err,
      );
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
