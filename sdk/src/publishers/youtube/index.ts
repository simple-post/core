import fs from "node:fs";

import { google } from "googleapis";

import { uploadYouTubeVideo, YOUTUBE_UPLOAD_ORIGIN } from "./resumable-upload";
import {
  getYouTubeVideoMetadata,
  validateYouTubeContent,
  YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES,
  YOUTUBE_MAX_VIDEO_SIZE_BYTES,
  YOUTUBE_VALIDATION_RULES,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, resolveThumbnailPath, TempFileManager } from "../../utils";
import { readinessFailure } from "../../utils/account-readiness";
import { validateContentForPlatform } from "../../validation";
import { Publisher, type MediaRequirement } from "../base";

import type { PostResult } from "../../types";
import type { PostOptions, Content, PostOptionsWithCredentials } from "../../types/post";
import type { ValidationIssue, PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { youtube_v3, Auth } from "googleapis";

const TOKEN_TIMEOUT_MS = 30_000;

export class YouTubePublisher extends Publisher {
  static readonly mediaRequirement: MediaRequirement = "path";

  static getValidationRules(): PlatformValidationRules {
    return YOUTUBE_VALIDATION_RULES;
  }

  private youtube: youtube_v3.Youtube;
  private readonly authClient: Auth.OAuth2Client;

  constructor(options?: PostOptionsWithCredentials) {
    super("YouTube", options, "youtube");

    // Validate the credentials
    if (!options?.youtube?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "YouTube credentials are required in options.youtube.credentials",
      );
    }

    const credentials = options.youtube.credentials;

    // Support two authentication methods:
    // 1. OAuth2 with refresh token (clientId, clientSecret, refreshToken)
    // 2. Direct access token (accessToken)
    let authClient: Auth.OAuth2Client;

    if ("accessToken" in credentials && credentials.accessToken) {
      // Method 2: Use access token directly
      this.logger.info(`[YouTubePublisher] Using access token authentication`);
      authClient = new google.auth.OAuth2();
      authClient.setCredentials({ access_token: credentials.accessToken });
    } else if ("clientId" in credentials && "clientSecret" in credentials && "refreshToken" in credentials) {
      // Method 1: Use OAuth2 with refresh token
      this.logger.info(`[YouTubePublisher] Using OAuth2 refresh token authentication`);
      const { clientId, clientSecret, refreshToken } = credentials;
      // Token refreshes share the upload deadline, so they must not hang indefinitely.
      authClient = new google.auth.OAuth2({
        clientId,
        clientSecret,
        transporterOptions: { timeout: TOKEN_TIMEOUT_MS },
      });
      authClient.setCredentials({ refresh_token: refreshToken });
    } else {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "YouTube credentials must include either (accessToken) or (clientId, clientSecret, refreshToken)",
      );
    }

    this.authClient = authClient;
    this.youtube = google.youtube({ version: "v3", auth: authClient });
  }

  /**
   * Header-only credential access for the resumable upload transport. The
   * auth library must never own the streamed request itself: it would replay
   * a consumed body on refresh and hide the retry policy enforced in the helper.
   */
  private async getAuthorization(): Promise<string> {
    const headers = await this.authClient.getRequestHeaders(YOUTUBE_UPLOAD_ORIGIN);
    const value = headers.get("authorization");
    if (!value) throw new Error("YouTube authorization header unavailable");
    return value;
  }

  async validateReadiness(content: Content, options?: PostOptions): Promise<ValidationIssue[]> {
    try {
      const issues: ValidationIssue[] = [];
      const response = await this.youtube.channels.list({ part: ["status"], mine: true }, { timeout: 10_000 });
      const channel = response.data.items?.[0];
      const add = (code: string, message: string, severity: "error" | "warning" = "error") =>
        issues.push({ platform: "youtube", severity, code, message, field: "account" });
      if (!channel)
        add(
          "youtube_channel_missing",
          "This connection does not have a YouTube channel. Create a channel and reconnect it.",
        );
      const video = content.media?.find((item) => item.type === "video");
      if (video && (video.durationSec ?? 0) > 900 && channel?.status?.longUploadsStatus === "disallowed")
        add(
          "youtube_long_uploads_disabled",
          "Enable longer uploads by verifying your YouTube channel, or use a video under 15 minutes.",
        );
      if (options?.youtube?.categoryId) {
        const categories = await this.youtube.videoCategories.list(
          { part: ["snippet"], id: [options.youtube.categoryId] },
          { timeout: 10_000 },
        );
        if (!categories.data.items?.some((item) => item.snippet?.assignable))
          add("youtube_category_unavailable", "Choose an assignable YouTube video category.");
      }
      if (
        options?.youtube?.thumbnailUrl ||
        options?.youtube?.thumbnailPath ||
        video?.thumbnailUrl ||
        video?.thumbnailPath
      )
        add(
          "youtube_thumbnail_eligibility_unverified",
          "YouTube does not expose custom-thumbnail eligibility in this check. Enable the feature in YouTube Studio before using a custom thumbnail.",
          "warning",
        );
      return issues;
    } catch (error) {
      return [readinessFailure("youtube", error)];
    }
  }

  static validate(content: Content, options?: PostOptions["youtube"]): ValidationResult {
    return validateContentForPlatform("youtube", content, { youtube: options });
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    if (options?.youtube?.playlistId) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "YouTube playlist assignment is temporarily unavailable. Remove playlistId and add the video to a playlist in YouTube Studio after publishing.",
        { code: "youtube_playlist_unavailable" },
      );
    }
    const startTime = Date.now();
    this.logger.info(`[YouTubePublisher] Starting video upload process`);

    const video = content.media?.find((m) => m.type === "video");
    this.logger.info(`[YouTubePublisher] Video found: ${video ? "Yes" : "No"}`);

    // Validate the video
    this.logger.info(`[YouTubePublisher] Validating video and metadata`);
    const validation = validateYouTubeContent(content, options?.youtube);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "YouTube content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }
    this.logger.info(`[YouTubePublisher] Video validation passed`);
    if (!video) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.");
    }
    const youtubeOptions = options?.youtube;
    const metadata = getYouTubeVideoMetadata(content, video, youtubeOptions);
    const safeTitle = metadata.title;
    const safeDescription = metadata.description;
    const thumbnailSource =
      youtubeOptions?.thumbnailPath || youtubeOptions?.thumbnailUrl
        ? {
            ...video,
            thumbnailPath: youtubeOptions.thumbnailPath,
            thumbnailUrl: youtubeOptions.thumbnailUrl,
          }
        : video;
    this.logger.info(
      `[YouTubePublisher] Video details: title="${safeTitle}", path="${video.path}", hasThumbnail=${!!(thumbnailSource.thumbnailPath || thumbnailSource.thumbnailUrl)}`,
    );

    const tempFileManager = new TempFileManager();

    try {
      // Resolve video path (download if URL)
      const { path: resolvedVideoPath, cleanup: videoCleanup } = await resolveMediaPath(video);
      tempFileManager.add(videoCleanup);

      // Resolve thumbnail path if provided (download if URL)
      const { path: resolvedThumbnailPath, cleanup: thumbnailCleanup } = await resolveThumbnailPath(thumbnailSource);
      tempFileManager.add(thumbnailCleanup);

      const privacyStatus = youtubeOptions?.publishAt ? "private" : youtubeOptions?.privacyStatus;
      const publishAt = youtubeOptions?.publishAt ? new Date(youtubeOptions.publishAt).toISOString() : undefined;

      this.logger.info(`[YouTubePublisher] Preparing video upload request`);
      this.logger.info(
        `[YouTubePublisher] Upload parameters: title="${safeTitle}", description="${safeDescription ? `${safeDescription.slice(0, 50)}...` : "None"}", tags=${youtubeOptions?.tags?.length || 0}, categoryId=${youtubeOptions?.categoryId || "Not set"}, privacyStatus=${privacyStatus || "Not set"}, publishAt=${publishAt || "Not set"}, selfDeclaredMadeForKids=${youtubeOptions?.selfDeclaredMadeForKids ?? false}`,
      );

      this.logger.info(`[YouTubePublisher] Starting video file upload from: ${resolvedVideoPath}`);
      const fileStats = fs.statSync(resolvedVideoPath);
      this.logger.info(
        `[YouTubePublisher] Video file size: ${fileStats.size} bytes (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`,
      );
      if (fileStats.size > YOUTUBE_MAX_VIDEO_SIZE_BYTES) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          `YouTube videos cannot exceed ${YOUTUBE_MAX_VIDEO_SIZE_BYTES / (1024 * 1024 * 1024)} GB.`,
        );
      }

      if (resolvedThumbnailPath) {
        const thumbnailStats = fs.statSync(resolvedThumbnailPath);
        this.logger.info(`[YouTubePublisher] Thumbnail file size: ${thumbnailStats.size} bytes`);
        if (thumbnailStats.size > YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            `YouTube custom thumbnails cannot exceed ${YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES / (1024 * 1024)} MB.`,
          );
        }
      }

      // Upload the video through one bounded resumable session. The helper
      // classifies every outcome itself; an ambiguous result is API_ERROR and
      // is never retried here, because a retry could create a duplicate video.
      let videoId: string;
      const warnings: { code: string; message: string }[] = [];
      try {
        const upload = await uploadYouTubeVideo({
          filePath: resolvedVideoPath,
          size: fileStats.size,
          metadata: {
            snippet: {
              title: safeTitle,
              description: safeDescription,
              tags: youtubeOptions?.tags,
              categoryId: youtubeOptions?.categoryId,
            },
            status: {
              privacyStatus: privacyStatus,
              publishAt: publishAt,
              selfDeclaredMadeForKids: youtubeOptions?.selfDeclaredMadeForKids ?? false,
            },
          },
          getAuthorization: () => this.getAuthorization(),
          logger: this.logger,
        });
        videoId = upload.videoId;
        this.logger.info(`[YouTubePublisher] Video upload successful! Video ID: ${videoId}`);
        this.logger.info(`[YouTubePublisher] Upload completed in ${Date.now() - startTime}ms`);
        // The insert response already carries status.uploadStatus. A failed or
        // rejected status is reported with the accepted ID so callers reconcile
        // instead of reposting; it never becomes a retryable publication error.
        if (upload.uploadStatus === "failed" || upload.uploadStatus === "rejected") {
          this.logger.warn(`[YouTubePublisher] Upload status "${upload.uploadStatus}" reported for ${videoId}`);
          warnings.push({
            code: "youtube_upload_status_warning",
            message: `YouTube accepted the upload as video ${videoId} but reported its status as "${upload.uploadStatus}". Do not repost this video; review it in YouTube Studio.`,
          });
        }
      } catch (error: unknown) {
        this.logger.error(`[YouTubePublisher] Video upload failed after ${Date.now() - startTime}ms`);
        if (error instanceof PostError) throw error;
        // Never attach the raw error: it may contain request headers or the session URI.
        throw new PostError(
          PostErrorType.API_ERROR,
          "YouTube did not confirm the video upload. The video may exist on the channel; check YouTube Studio before reposting.",
          { stage: "upload", code: "youtube_upload_unexpected_error" },
        );
      }

      // Upload the thumbnail if provided
      if (resolvedThumbnailPath) {
        try {
          this.logger.info(`[YouTubePublisher] Uploading thumbnail for video ${videoId}`);

          await this.youtube.thumbnails.set({
            videoId: videoId,
            media: {
              body: fs.createReadStream(resolvedThumbnailPath),
            },
          });

          this.logger.info(`[YouTubePublisher] Thumbnail upload successful for video ${videoId}`);
        } catch {
          // The raw error can carry request URLs with credentials, so it is not logged.
          this.logger.warn(`[YouTubePublisher] Failed to upload thumbnail for video ${videoId}`);
          // The video already exists. Surface the partial failure without making
          // callers retry the upload and create a duplicate video.
          warnings.push({
            code: "youtube_thumbnail_upload_failed",
            message:
              "Video published, but YouTube could not apply the custom thumbnail. Do not repost this video; check custom-thumbnail eligibility in YouTube Studio and update the existing video there.",
          });
        }
      } else {
        this.logger.info(`[YouTubePublisher] No thumbnail provided for video ${videoId}`);
      }

      this.logger.info(
        `[YouTubePublisher] Post content process completed successfully. Total time: ${Date.now() - startTime}ms`,
      );
      return {
        id: videoId,
        error: PostErrorType.NO_ERROR,
        ...(warnings.length > 0
          ? {
              message: warnings.map((warning) => warning.message).join(" "),
              details: { code: warnings[0].code, videoId },
            }
          : {}),
      };
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
