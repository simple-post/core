import axios from "axios";

import { THREADS_VALIDATION_RULES, validateThreadsContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const THREADS_API_VERSION = "v1.0";
const PROCESSING_POLL_INTERVAL = 2000;
const PROCESSING_MAX_ATTEMPTS = 12;
const PROACTIVE_REFRESH_DAYS = 7;

interface ThreadsAxiosErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: {
        code?: number;
        message?: string;
        type?: string;
      };
    };
  };
  message?: string;
}

export class ThreadsPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  static getValidationRules(): PlatformValidationRules {
    return THREADS_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private userId: string;
  private accessToken: string;
  private expiresAt?: number;
  private s3MediaUploader: S3MediaUploader | null = null;
  private s3TempFileKeys: string[] = [];
  private refreshedCredentials?: { accessToken: string; expiresAt: number };

  constructor(options?: PostOptionsWithCredentials) {
    super("Threads", options);

    if (!options?.threads?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Threads credentials are required in options.threads.credentials",
      );
    }

    const { accessToken, userId, expiresAt } = options.threads.credentials;
    this.accessToken = accessToken;
    this.userId = userId;
    this.expiresAt = expiresAt;

    this.client = axios.create({
      baseURL: `https://graph.threads.net/${THREADS_API_VERSION}`,
      timeout: 30_000,
      headers: {
        "Content-Type": "application/json",
      },
    });
    // S3MediaUploader is lazily initialized only when media upload is needed
  }

  private isTokenExpiringSoon(): boolean {
    if (!this.expiresAt) return false;
    const now = Math.floor(Date.now() / 1000);
    const sevenDays = PROACTIVE_REFRESH_DAYS * 24 * 60 * 60;
    return now >= this.expiresAt - sevenDays;
  }

  private async refreshAccessToken(): Promise<void> {
    const currentToken = this.refreshedCredentials?.accessToken || this.accessToken;

    try {
      this.logger.info("Refreshing Threads access token...");

      const url = new URL("https://graph.threads.net/refresh_access_token");
      url.searchParams.set("grant_type", "th_refresh_token");
      url.searchParams.set("access_token", currentToken);

      const response = await axios.get<{ access_token: string; token_type: string; expires_in: number }>(
        url.toString(),
      );
      const { access_token, expires_in } = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

      this.refreshedCredentials = { accessToken: access_token, expiresAt };
      this.accessToken = access_token;
      this.expiresAt = expiresAt;

      this.logger.info("Threads access token refreshed successfully");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(`Failed to refresh Threads token: ${err.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Threads access token has expired. Please reconnect your Threads account in account settings.",
        err.response?.data?.error?.message || err.message,
      );
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.isTokenExpiringSoon()) {
      await this.refreshAccessToken();
    }
  }

  private isAuthError(error: unknown): boolean {
    const err = error as ThreadsAxiosErrorLike;
    const apiError = err.response?.data?.error;
    const message = `${apiError?.message ?? ""} ${err.message ?? ""}`.toLowerCase();

    return (
      err.response?.status === 401 ||
      apiError?.code === 190 ||
      message.includes("session has expired") ||
      message.includes("access token has expired") ||
      message.includes("error validating access token")
    );
  }

  private async withTokenRefresh<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (!this.isAuthError(error)) {
        throw error;
      }

      this.logger.warn("Threads API rejected the access token, attempting refresh...");
      await this.refreshAccessToken();
      return request();
    }
  }

  private async cleanupS3Files(): Promise<void> {
    if (this.s3MediaUploader && this.s3TempFileKeys.length > 0) {
      await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader!.deleteFile(key)));
    }
  }

  private async waitForMediaReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < PROCESSING_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.withTokenRefresh(() =>
          this.client.get(`/${containerId}`, {
            params: {
              fields: "status",
              access_token: this.accessToken,
            },
          }),
        );

        const status = response.data?.status;
        if (status === "FINISHED" || status === "READY") {
          return;
        }

        if (status === "ERROR") {
          throw new PostError(
            PostErrorType.API_ERROR,
            `Threads media container ${containerId} creation failed.`,
            response.data,
          );
        }
        // "IN_PROGRESS", "PUBLISHED", or no status — keep polling.
      } catch (error: unknown) {
        // Right after creation the container may not yet be queryable
        // (Threads returns "The requested resource does not exist"). Treat
        // any non-final error as transient and keep polling.
        if (error instanceof PostError) throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_INTERVAL));
    }

    throw new PostError(PostErrorType.API_ERROR, "Threads media processing timed out.");
  }

  static validate(content: Content): ValidationResult {
    return validateThreadsContent(content);
  }

  private getS3Uploader(): S3MediaUploader {
    if (!this.s3MediaUploader) {
      this.s3MediaUploader = new S3MediaUploader();
    }
    return this.s3MediaUploader;
  }

  /**
   * Resolves the Threads user ID from the /me endpoint.
   * The token exchange may return an ID that doesn't match what the publish API expects;
   * /me returns the correct app-scoped threads-user-id for the current token.
   */
  private async resolveUserId(): Promise<string> {
    const response = await this.withTokenRefresh(() =>
      this.client.get("/me", {
        params: { fields: "id", access_token: this.accessToken },
      }),
    );
    const id = response.data?.id;
    if (!id) {
      throw new PostError(PostErrorType.API_ERROR, "Threads /me did not return user id.", response.data);
    }
    return String(id);
  }

  private async resolveMedia(media: Media): Promise<{ type: "IMAGE" | "VIDEO"; url: string }> {
    const { url, uploadedKey } = await resolveMediaUrl(media, (filePath, key) =>
      this.getS3Uploader().uploadFile(filePath, key),
    );

    if (uploadedKey) {
      this.s3TempFileKeys.push(uploadedKey);
      this.logger.info(`Media uploaded to S3: ${url}`);
    } else {
      this.logger.info(`Using provided URL: ${url}`);
    }

    return {
      type: media.type === "video" ? "VIDEO" : "IMAGE",
      url,
    };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const replyToId = options?.threads?.replyToId;
    const validation = ThreadsPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Threads content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    await this.ensureValidToken();

    const media = content.media?.[0];

    try {
      // Resolve user ID from /me - the stored ID may not match what the publish API expects
      let threadsUserId: string;
      try {
        threadsUserId = await this.resolveUserId();
      } catch (resolveError) {
        if (resolveError instanceof PostError && resolveError.errorType === PostErrorType.CREDENTIALS_ERROR) {
          throw resolveError;
        }
        const errorMessage = resolveError instanceof Error ? resolveError.message : String(resolveError);
        this.logger.warn(`Threads /me failed, using stored userId (${this.userId}): ${errorMessage}`);
        threadsUserId = this.userId;
      }

      const basePayload: Record<string, unknown> = {
        access_token: this.accessToken,
      };

      if (content.text) {
        basePayload.text = content.text;
      }

      if (replyToId) {
        basePayload.reply_to_id = replyToId;
      }

      if (media) {
        const resolvedMedia = await this.resolveMedia(media);
        basePayload.media_type = resolvedMedia.type;
        if (resolvedMedia.type === "IMAGE") {
          basePayload.image_url = resolvedMedia.url;
        } else {
          basePayload.video_url = resolvedMedia.url;
        }
      } else {
        // Text-only posts require media_type to be "TEXT"
        basePayload.media_type = "TEXT";
      }

      const createResponse = await this.withTokenRefresh(() =>
        this.client.post(`/${threadsUserId}/threads`, {
          ...basePayload,
          access_token: this.accessToken,
        }),
      );
      const creationId = String(createResponse.data?.id || createResponse.data?.creation_id || "");

      if (!creationId) {
        throw new PostError(PostErrorType.API_ERROR, "Threads API did not return a creation id.");
      }

      this.logger.info(`Threads container created — creationId: ${creationId}, userId: ${threadsUserId}`);

      // Threads recommends waiting until the container reports FINISHED before
      // publishing. Skipping this for text/image replies caused intermittent
      // "The requested resource does not exist" errors on threads_publish
      // because the container had not yet propagated server-side.
      await this.waitForMediaReady(creationId);

      const publishResponse = await this.withTokenRefresh(() =>
        this.client.post(`/${threadsUserId}/threads_publish`, {
          access_token: this.accessToken,
          creation_id: creationId,
        }),
      );

      const publishId = String(publishResponse.data?.id || publishResponse.data?.post_id || creationId);

      // Fetch the permalink. The GET also returns the canonical id; we use it
      // when available because it is the addressable Threads media id that
      // the API accepts for `reply_to_id` on subsequent replies.
      let canonicalId = publishId;
      let permalink: string | undefined;
      try {
        const permalinkRes = await this.withTokenRefresh(() =>
          this.client.get(`/${publishId}`, {
            params: { fields: "id,permalink", access_token: this.accessToken },
          }),
        );
        if (typeof permalinkRes.data?.id === "string" || typeof permalinkRes.data?.id === "number") {
          canonicalId = String(permalinkRes.data.id);
        }
        if (typeof permalinkRes.data?.permalink === "string") {
          permalink = permalinkRes.data.permalink;
        }
      } catch (permalinkError) {
        const err = permalinkError as { message?: string };
        this.logger.warn(`Failed to fetch Threads post metadata: ${err.message || String(permalinkError)}`);
      }

      this.logger.info(
        `Threads post IDs — creationId: ${creationId}, publishId: ${publishId}, canonicalId: ${canonicalId}`,
      );

      return {
        id: canonicalId,
        url: permalink,
        error: PostErrorType.NO_ERROR,
        ...(this.refreshedCredentials && {
          extraData: {
            refreshedCredentials: {
              accessToken: this.refreshedCredentials.accessToken,
              expiresAt: this.refreshedCredentials.expiresAt,
            },
          },
        }),
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      if (error instanceof PostError) throw error;

      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Threads: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
