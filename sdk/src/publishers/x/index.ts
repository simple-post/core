import fs from "node:fs";

import axios from "axios";
import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

import { X_MAX_MEDIA_COUNT, X_VALIDATION_RULES, validateXContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult, RepostResult } from "../../types";
import type { Content, PostOptionsWithCredentials, QuoteTarget, RepostTarget, XCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
}

export class XPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return X_VALIDATION_RULES;
  }

  private client: TwitterApi;

  private credentials: XCredentials;

  private refreshedCredentials?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };

  // Cached authenticated user id. Seeded from credentials.userId when the
  // caller already knows it (avoiding a users/me round-trip entirely) and
  // otherwise populated on first lookup so repeated calls don't re-fetch.
  private cachedUserId?: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("X", options);

    if (!options?.x?.credentials) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials");
    }

    this.credentials = options.x.credentials;
    this.cachedUserId = this.credentials.userId;

    const canRefresh = Boolean(this.credentials.clientId && this.credentials.refreshToken);
    if (!this.credentials.accessToken && !canRefresh) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "X credentials require either accessToken, or clientId + refreshToken (or both)",
      );
    }

    // If no cached access token is provided, isTokenExpired() will force a refresh on first use.
    this.client = new TwitterApi(this.credentials.accessToken ?? "");
  }

  private canRefresh(): boolean {
    return Boolean(
      this.credentials.clientId && (this.refreshedCredentials?.refreshToken || this.credentials.refreshToken),
    );
  }

  private isTokenExpired(): boolean {
    // No way to refresh — treat the supplied access token as fresh and let X reject it
    // with a 401 if it has actually expired. The caller controls token lifecycle.
    if (!this.canRefresh()) {
      return false;
    }

    // We've already refreshed within this publisher's lifetime — use that expiry.
    if (this.refreshedCredentials) {
      const now = Math.floor(Date.now() / 1000);
      return now >= this.refreshedCredentials.expiresAt - 60;
    }

    // No cached access token / expiry → must refresh before first call.
    if (!this.credentials.accessToken || !this.credentials.expiresAt) {
      return true;
    }

    const now = Math.floor(Date.now() / 1000);
    return now >= this.credentials.expiresAt - 60;
  }

  private async ensureValidToken(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  private getCurrentAccessToken(): string {
    const accessToken = this.refreshedCredentials?.accessToken ?? this.credentials.accessToken;
    if (!accessToken) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "X access token is required");
    }
    return accessToken;
  }

  private async refreshAccessToken(): Promise<void> {
    const { clientId, clientSecret, refreshToken } = this.credentials;
    const currentRefreshToken = this.refreshedCredentials?.refreshToken || refreshToken;

    if (!clientId || !currentRefreshToken) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Cannot refresh X access token: clientId and refreshToken are required",
      );
    }

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
            ...(clientSecret
              ? {
                  Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                }
              : {}),
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

  private static getMimeType(filePath: string): EUploadMimeType {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, EUploadMimeType> = {
      jpg: EUploadMimeType.Jpeg,
      jpeg: EUploadMimeType.Jpeg,
      png: EUploadMimeType.Png,
      gif: EUploadMimeType.Gif,
      webp: EUploadMimeType.Webp,
      mp4: EUploadMimeType.Mp4,
      mov: EUploadMimeType.Mov,
    };
    return mimeTypes[ext ?? ""] ?? EUploadMimeType.Jpeg;
  }

  private async uploadMedia(resolvedPath: string): Promise<string> {
    // Check if the media file exists
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    const mimeType = XPublisher.getMimeType(resolvedPath);
    const buffer = fs.readFileSync(resolvedPath);

    // Upload the media using the X V2 API
    try {
      const mediaId = await this.client.v2.uploadMedia(buffer, { media_type: mimeType });

      this.logger.info(`Media uploaded: ${mediaId}`);

      return mediaId;
    } catch (error: unknown) {
      const err = error as { data?: unknown };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(PostErrorType.API_ERROR, `Failed to upload media: ${error}`, err.data);
    }
  }

  static validate(content: Content): ValidationResult {
    return validateXContent(content);
  }

  async postContent(
    content: Content,
    options?: PostOptionsWithCredentials,
    quoteTarget?: QuoteTarget,
  ): Promise<PostResult> {
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
        for (const media of content.media.slice(0, X_MAX_MEDIA_COUNT)) {
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
        ...(quoteTarget ? { quote_tweet_id: quoteTarget.postId } : {}),
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

  async quoteContent(content: Content, target: QuoteTarget, options?: PostOptionsWithCredentials): Promise<PostResult> {
    return this.postContent(content, options, target);
  }

  private async resolveUserId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    const accessToken = this.getCurrentAccessToken();
    const meResponse = await axios.get<{ data?: { id?: string } }>("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const userId = meResponse.data?.data?.id;
    if (!userId) {
      throw new PostError(PostErrorType.API_ERROR, "X API did not return the authenticated user id.");
    }

    this.cachedUserId = userId;
    return userId;
  }

  async repostContent(target: RepostTarget): Promise<RepostResult> {
    await this.ensureValidToken();
    const accessToken = this.getCurrentAccessToken();

    try {
      const userId = await this.resolveUserId();

      await axios.post(
        `https://api.x.com/2/users/${userId}/retweets`,
        { tweet_id: target.postId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      const result: RepostResult = {
        id: target.postId,
        error: PostErrorType.NO_ERROR,
      };

      if (this.refreshedCredentials) {
        result.extraData = {
          refreshedCredentials: this.refreshedCredentials,
        };
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: unknown }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to repost on X: ${err.message || "Unknown error"}`,
        err.response?.data || err.message,
      );
    }
  }
}
