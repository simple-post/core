import fs from "node:fs";

import axios from "axios";
import { TwitterApi } from "twitter-api-v2";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type {
  Content,
  PostOptionsWithCredentials,
  XAppCredentials,
  XCredentials,
  XUserCredentials,
} from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { TwitterApiv1 } from "twitter-api-v2";

const MAX_TEXT_LENGTH = 280;
const MAX_MEDIA_COUNT = 4;
const MAX_VIDEOS = 1;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: MAX_TEXT_LENGTH },
  media: { maxCount: MAX_MEDIA_COUNT, maxImages: MAX_MEDIA_COUNT, maxVideos: MAX_VIDEOS, allowsMixed: false },
};

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
}

export class XPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: TwitterApi;
  private clientV1: TwitterApiv1;

  private credentials: XCredentials;

  private isUserCredentials: boolean;

  private refreshedCredentials?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };

  constructor(options?: PostOptionsWithCredentials) {
    super("X", options);

    // Validate the credentials
    if (!options?.x?.credentials) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials");
    }

    // Check if the credentials are user credentials or app credentials
    this.credentials = options.x.credentials;
    this.isUserCredentials = "refreshToken" in options.x.credentials;

    // Initialize the clients
    this.client = this.isUserCredentials
      ? (this.client = new TwitterApi(this.credentials.accessToken))
      : (this.client = new TwitterApi({
          appKey: (this.credentials as XAppCredentials).apiKey,
          appSecret: (this.credentials as XAppCredentials).apiSecret,
          accessToken: this.credentials.accessToken,
          accessSecret: (this.credentials as XAppCredentials).accessSecret,
        }));

    this.clientV1 = this.client.v1;
  }

  private isTokenExpired(): boolean {
    // App credentials don't expire
    if (!this.isUserCredentials) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = this.refreshedCredentials?.expiresAt || (this.credentials as XUserCredentials).expiresAt;

    // Consider token expired if it expires within the next 1 minute
    return now >= expiresAt - 60;
  }

  private async ensureValidToken(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  private async refreshAccessToken(): Promise<void> {
    // No need to refresh app credentials
    if (!this.isUserCredentials) {
      return;
    }

    const { clientId, clientSecret, refreshToken } = this.credentials as XUserCredentials;
    const currentRefreshToken = this.refreshedCredentials?.refreshToken || refreshToken;

    try {
      this.logger.info("Refreshing X access token...");

      const response = await axios.post<RefreshTokenResponse>(
        "https://api.x.com/2/oauth2/token",
        new URLSearchParams({
          refresh_token: currentRefreshToken,
          grant_type: "refresh_token",
          client_id: clientId,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          },
        },
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

      this.refreshedCredentials = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
      };

      // Re-initialize client with new access token
      this.client = new TwitterApi(access_token);
      this.clientV1 = this.client.v1;

      this.logger.info("X access token refreshed successfully");
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      this.logger.error(`Failed to refresh X access token: ${err.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Failed to refresh X access token",
        err.response?.data || err.message,
      );
    }
  }

  private async uploadMedia(resolvedPath: string): Promise<string> {
    // Check if the media file exists
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    // Upload the media using the Twitter V1 API
    try {
      const mediaId = await this.clientV1.uploadMedia(resolvedPath);

      this.logger.info(`Media uploaded: ${mediaId}`);

      return mediaId;
    } catch (error: unknown) {
      const err = error as { data?: unknown };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(PostErrorType.API_ERROR, `Failed to upload media: ${error}`, err.data);
    }
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    let images = 0;
    let videos = 0;
    for (const item of media) {
      if (item.type === "image") images += 1;
      if (item.type === "video") videos += 1;
    }

    // Check for empty content
    if (!text.trim() && mediaCount === 0) {
      errors.push({
        platform: "x",
        severity: "error",
        code: "content_required",
        message: "X posts require text or media.",
        field: "text",
      });
    }

    // Check text length
    if (text.length > MAX_TEXT_LENGTH) {
      errors.push({
        platform: "x",
        severity: "error",
        code: "text_too_long",
        message: `X text cannot exceed ${MAX_TEXT_LENGTH} characters.`,
        field: "text",
        limit: MAX_TEXT_LENGTH,
        actual: text.length,
      });
    }

    // Check media sources
    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "x",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    // Check for mixed media (images + videos)
    if (videos > 0 && images > 0) {
      errors.push({
        platform: "x",
        severity: "error",
        code: "mixed_media_not_supported",
        message: "X posts cannot mix images and videos.",
        field: "media",
      });
    }

    // Check video count
    if (videos > MAX_VIDEOS) {
      errors.push({
        platform: "x",
        severity: "error",
        code: "too_many_videos",
        message: "X supports only one video per post.",
        field: "media",
        limit: MAX_VIDEOS,
        actual: videos,
      });
    }

    // Warn about excess images
    if (images > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "x",
        severity: "warning",
        code: "too_many_images",
        message: `X supports up to ${MAX_MEDIA_COUNT} images. Only the first ${MAX_MEDIA_COUNT} will be posted.`,
        field: "media",
        limit: MAX_MEDIA_COUNT,
        actual: images,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const replyToId = options?.x?.replyToId;

    // Validate the content
    const validation = XPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "X content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    // Ensure we have a valid token before posting
    await this.ensureValidToken();

    const tempFileManager = new TempFileManager();

    try {
      // Upload all media files if any
      const mediaIds: string[] = [];
      if (content.media) {
        for (const media of content.media.slice(0, MAX_MEDIA_COUNT)) {
          // Resolve media path (download if URL)
          const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
          tempFileManager.add(cleanup);

          const mediaId = await this.uploadMedia(resolvedPath);
          mediaIds.push(mediaId);
        }
      }

      // Post the tweet
      const { data: createdTweet } = await this.client.v2.tweet(content.text || "", {
        media: mediaIds.length > 0 ? { media_ids: mediaIds as [string, string, string, string] } : undefined,
        reply: replyToId ? { in_reply_to_tweet_id: replyToId } : undefined,
      });

      const result: PostResult = {
        id: createdTweet.id,
        error: PostErrorType.NO_ERROR,
      };

      // Include refreshed credentials if they were updated
      if (this.refreshedCredentials) {
        result.extraData = {
          refreshedCredentials: this.refreshedCredentials,
        };
      }

      return result;
    } catch (error: unknown) {
      const err = error as { data?: unknown };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(PostErrorType.API_ERROR, `Failed to post content: ${error}`, err.data);
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
