import fs from "node:fs";

import axios from "axios";
import { TwitterApi } from "twitter-api-v2";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type {
  Content,
  Media,
  PostOptionsWithCredentials,
  XAppCredentials,
  XCredentials,
  XUserCredentials,
} from "../../types/post";
import type { TwitterApiv1 } from "twitter-api-v2";

const MAX_MEDIA_COUNT = 4;

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
}

export class XPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

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
    } catch (error: any) {
      this.logger.error(`Failed to refresh X access token: ${error.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Failed to refresh X access token",
        error.response?.data || error.message,
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
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to upload media: ${error}`, error.data);
    }
  }

  private validate(content: Content): asserts content is (Content & { text: string }) | (Content & { media: Media[] }) {
    if (!content.text && (!content.media || content.media.length === 0))
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported");

    this.strictCheck(
      content.media && content.media.length > MAX_MEDIA_COUNT,
      `X supports up to ${MAX_MEDIA_COUNT} media files, only the first ${MAX_MEDIA_COUNT} will be uploaded`,
    );

    // Validate each media has a valid source (path or url)
    if (content.media) {
      for (const media of content.media) {
        if (!hasValidSource(media)) {
          throw new PostError(PostErrorType.INVALID_CONTENT, "Media must have either a path or url");
        }
        // If path is provided, check it exists
        if (media.path && !fs.existsSync(media.path)) {
          throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
        }
      }
    }
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const replyToId = options?.x?.replyToId;

    // Validate the content
    this.validate(content);

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
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to post content: ${error}`, error.data);
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
