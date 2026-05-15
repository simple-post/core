import fs from "node:fs";

import { google } from "googleapis";

import {
  getYouTubeVideoMetadata,
  validateYouTubeContent,
  YOUTUBE_MAX_DESCRIPTION_LENGTH,
  YOUTUBE_MAX_TITLE_LENGTH,
  YOUTUBE_VALIDATION_RULES,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, resolveThumbnailPath, TempFileManager } from "../../utils";
import { Publisher, type MediaRequirement } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { youtube_v3, Auth } from "googleapis";

export class YouTubePublisher extends Publisher {
  static readonly mediaRequirement: MediaRequirement = "path";

  static getValidationRules(): PlatformValidationRules {
    return YOUTUBE_VALIDATION_RULES;
  }

  private youtube: youtube_v3.Youtube;

  constructor(options?: PostOptionsWithCredentials) {
    super("YouTube", options);

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
      authClient = new google.auth.OAuth2(clientId, clientSecret);
      authClient.setCredentials({ refresh_token: refreshToken });
    } else {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "YouTube credentials must include either (accessToken) or (clientId, clientSecret, refreshToken)",
      );
    }

    this.youtube = google.youtube({ version: "v3", auth: authClient });
  }

  static validate(content: Content): ValidationResult {
    return validateYouTubeContent(content);
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const startTime = Date.now();
    this.logger.info(`[YouTubePublisher] Starting video upload process`);

    const video = content.media?.find((m) => m.type === "video");
    this.logger.info(`[YouTubePublisher] Video found: ${video ? "Yes" : "No"}`);

    // Validate the video
    this.logger.info(`[YouTubePublisher] Validating video and metadata`);
    const validation = YouTubePublisher.validate(content);
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
    const metadata = getYouTubeVideoMetadata(content, video);
    const safeTitle =
      metadata.title.length > YOUTUBE_MAX_TITLE_LENGTH
        ? metadata.title.slice(0, YOUTUBE_MAX_TITLE_LENGTH)
        : metadata.title;
    const safeDescription =
      metadata.description && metadata.description.length > YOUTUBE_MAX_DESCRIPTION_LENGTH
        ? metadata.description.slice(0, YOUTUBE_MAX_DESCRIPTION_LENGTH)
        : metadata.description;
    const youtubeOptions = options?.youtube;
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

      // Upload the video
      let videoId: string;
      try {
        const response = await this.youtube.videos.insert({
          part: ["snippet", "status"],
          requestBody: {
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
          media: {
            body: fs.createReadStream(resolvedVideoPath),
          },
        });

        videoId = response.data.id!;
        this.logger.info(`[YouTubePublisher] Video upload successful! Video ID: ${videoId}`);
        this.logger.info(`[YouTubePublisher] Upload completed in ${Date.now() - startTime}ms`);
      } catch (error: unknown) {
        const err = error as {
          response?: { data?: { error?: { message?: string; code?: number } } };
          message?: string;
        };
        this.logger.error(
          `[YouTubePublisher] Video upload failed after ${Date.now() - startTime}ms: ${error instanceof Error ? error.message : String(error)}`,
        );

        let errorMessage = "Failed to upload video";

        const data = err.response?.data as { error?: string | { message?: string; error?: string } } | undefined;
        const errorCode = typeof data?.error === "string" ? data.error : data?.error?.error;

        if (errorCode === "invalid_grant") {
          errorMessage = "Your YouTube connection has expired. Please reconnect your YouTube account in Settings.";
          this.logger.error(`[YouTubePublisher] invalid_grant - refresh token invalid or revoked`);
        } else if (typeof data?.error === "object" && data.error?.message) {
          errorMessage = data.error.message;
          this.logger.error(`[YouTubePublisher] YouTube API error: ${JSON.stringify(data.error)}`);
        } else if (err.message) {
          errorMessage = err.message;
          this.logger.error(`[YouTubePublisher] Error message: ${err.message}`);
        }

        // Pass only the serializable API error object, not the full axios/request object
        const apiErrorDetails = err.response?.data?.error
          ? { error: err.response.data.error, status: (err as { response?: { status?: number } }).response?.status }
          : undefined;

        throw new PostError(PostErrorType.API_ERROR, errorMessage, apiErrorDetails);
      }

      // Upload the thumbnail if provided
      if (resolvedThumbnailPath) {
        try {
          this.logger.info(`[YouTubePublisher] Uploading thumbnail for video ${videoId}`);
          const thumbnailStats = fs.statSync(resolvedThumbnailPath);
          this.logger.info(`[YouTubePublisher] Thumbnail file size: ${thumbnailStats.size} bytes`);

          await this.youtube.thumbnails.set({
            videoId: videoId,
            media: {
              body: fs.createReadStream(resolvedThumbnailPath),
            },
          });

          this.logger.info(`[YouTubePublisher] Thumbnail upload successful for video ${videoId}`);
        } catch (error: unknown) {
          this.logger.warn(
            `[YouTubePublisher] Failed to upload thumbnail for video ${videoId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Don't throw - thumbnail upload failure shouldn't fail the whole post
        }
      } else {
        this.logger.info(`[YouTubePublisher] No thumbnail provided for video ${videoId}`);
      }

      // Add to playlist if playlist ID is provided
      if (options?.youtube?.playlistId) {
        try {
          this.logger.info(`[YouTubePublisher] Adding video ${videoId} to playlist: ${options.youtube.playlistId}`);
          await this.youtube.playlistItems.insert({
            part: ["snippet"],
            requestBody: {
              snippet: {
                playlistId: options.youtube.playlistId,
                resourceId: {
                  kind: "youtube#video",
                  videoId: videoId,
                },
              },
            },
          });
          this.logger.info(`[YouTubePublisher] Successfully added video ${videoId} to playlist`);
        } catch (error: unknown) {
          this.logger.warn(
            `[YouTubePublisher] Failed to add video ${videoId} to playlist ${options.youtube.playlistId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Don't throw - playlist addition failure shouldn't fail the whole post
        }
      } else {
        this.logger.info(`[YouTubePublisher] No playlist ID provided, skipping playlist addition`);
      }

      this.logger.info(
        `[YouTubePublisher] Post content process completed successfully. Total time: ${Date.now() - startTime}ms`,
      );
      return {
        id: videoId,
        error: PostErrorType.NO_ERROR,
      };
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
