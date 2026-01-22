import fs from "node:fs";

import { google } from "googleapis";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, resolveThumbnailPath, TempFileManager } from "../../utils";
import { Publisher, type MediaRequirement } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials, Video } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { youtube_v3, Auth } from "googleapis";

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxVideos: 1, allowsMixed: false },
  video: {
    requiresVideo: true,
    maxTitleLength: MAX_TITLE_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  },
};

export class YouTubePublisher extends Publisher {
  static readonly mediaRequirement: MediaRequirement = "path";

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
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

  private static getVideoMetadata(content: Content, video: Video): { title: string; description?: string } {
    const fallbackTitle = content.text?.trim() || "Untitled Video";
    const title = video.title?.trim() || fallbackTitle;
    const description = video.description?.trim() || content.text?.trim() || undefined;
    return { title, description };
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const media = content.media ?? [];

    let videos = 0;
    let images = 0;
    for (const item of media) {
      if (item.type === "video") videos += 1;
      if (item.type === "image") images += 1;
    }

    // Check for required video
    if (media.length === 0 || videos === 0) {
      errors.push({
        platform: "youtube",
        severity: "error",
        code: "video_required",
        message: "YouTube posts require a video.",
        field: "video",
      });
    }

    // Check media sources
    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "youtube",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    // Warn about extra videos
    if (videos > 1) {
      warnings.push({
        platform: "youtube",
        severity: "warning",
        code: "too_many_videos",
        message: "YouTube supports only one video per post. Only the first video will be uploaded.",
        field: "media",
        limit: 1,
        actual: videos,
      });
    }

    // Warn about images (they will be ignored)
    if (images > 0) {
      warnings.push({
        platform: "youtube",
        severity: "warning",
        code: "images_ignored",
        message: "YouTube posts ignore images. Only the first video will be uploaded.",
        field: "media",
      });
    }

    const video = media.find((item) => item.type === "video") as Video | undefined;

    if (video) {
      // Check title length
      const metadata = YouTubePublisher.getVideoMetadata(content, video);
      if (video.title && video.title.length > MAX_TITLE_LENGTH) {
        errors.push({
          platform: "youtube",
          severity: "error",
          code: "title_too_long",
          message: `YouTube titles cannot exceed ${MAX_TITLE_LENGTH} characters.`,
          field: "title",
          limit: MAX_TITLE_LENGTH,
          actual: video.title.length,
        });
      } else if (!video.title && metadata.title.length > MAX_TITLE_LENGTH) {
        // Warn that derived title will be truncated
        warnings.push({
          platform: "youtube",
          severity: "warning",
          code: "title_truncated",
          message: `YouTube titles cannot exceed ${MAX_TITLE_LENGTH} characters. The title will be truncated.`,
          field: "title",
          limit: MAX_TITLE_LENGTH,
          actual: metadata.title.length,
        });
      }

      // Check description length
      if (metadata.description && metadata.description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push({
          platform: "youtube",
          severity: "error",
          code: "description_too_long",
          message: `YouTube descriptions cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
          field: "description",
          limit: MAX_DESCRIPTION_LENGTH,
          actual: metadata.description.length,
        });
      }
    }

    return { errors, warnings, isValid: errors.length === 0 };
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
    const metadata = YouTubePublisher.getVideoMetadata(content, video);
    const safeTitle =
      metadata.title.length > MAX_TITLE_LENGTH ? metadata.title.slice(0, MAX_TITLE_LENGTH) : metadata.title;
    const safeDescription =
      metadata.description && metadata.description.length > MAX_DESCRIPTION_LENGTH
        ? metadata.description.slice(0, MAX_DESCRIPTION_LENGTH)
        : metadata.description;
    this.logger.info(
      `[YouTubePublisher] Video details: title="${safeTitle}", path="${video.path}", hasThumbnail=${!!video.thumbnailPath}`,
    );

    const tempFileManager = new TempFileManager();

    try {
      // Resolve video path (download if URL)
      const { path: resolvedVideoPath, cleanup: videoCleanup } = await resolveMediaPath(video);
      tempFileManager.add(videoCleanup);

      // Resolve thumbnail path if provided (download if URL)
      const { path: resolvedThumbnailPath, cleanup: thumbnailCleanup } = await resolveThumbnailPath(video);
      tempFileManager.add(thumbnailCleanup);

      const privacyStatus = options?.youtube?.publishAt ? "private" : options?.youtube?.privacyStatus;
      const publishAt = options?.youtube?.publishAt ? new Date(options.youtube.publishAt).toISOString() : undefined;

      this.logger.info(`[YouTubePublisher] Preparing video upload request`);
      this.logger.info(
        `[YouTubePublisher] Upload parameters: title="${safeTitle}", description="${safeDescription ? `${safeDescription.slice(0, 50)}...` : "None"}", tags=${options?.youtube?.tags?.length || 0}, categoryId=${options?.youtube?.categoryId || "Not set"}, privacyStatus=${privacyStatus || "Not set"}, publishAt=${publishAt || "Not set"}, selfDeclaredMadeForKids=${options?.youtube?.selfDeclaredMadeForKids ?? false}`,
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
              tags: options?.youtube?.tags,
              categoryId: options?.youtube?.categoryId,
            },
            status: {
              privacyStatus: privacyStatus,
              publishAt: publishAt,
              selfDeclaredMadeForKids: options?.youtube?.selfDeclaredMadeForKids ?? false,
            },
          },
          media: {
            body: fs.createReadStream(resolvedVideoPath),
          },
        });

        videoId = response.data.id!;
        this.logger.info(`[YouTubePublisher] Video upload successful! Video ID: ${videoId}`);
        this.logger.info(`[YouTubePublisher] Upload completed in ${Date.now() - startTime}ms`);
      } catch (error: any) {
        this.logger.error(
          `[YouTubePublisher] Video upload failed after ${Date.now() - startTime}ms: ${error instanceof Error ? error.message : String(error)}`,
        );

        let errorMessage = "Failed to upload video";

        if (error.response && error.response.data && error.response.data.error) {
          errorMessage = error.response.data.error.message;
          this.logger.error(`[YouTubePublisher] YouTube API error: ${JSON.stringify(error.response.data.error)}`);
        } else if (error.message) {
          errorMessage = error.message;
          this.logger.error(`[YouTubePublisher] Error message: ${error.message}`);
        }

        throw new PostError(PostErrorType.API_ERROR, errorMessage, error);
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
        } catch (error: any) {
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
        } catch (error: any) {
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
