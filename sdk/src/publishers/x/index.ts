import fs from "node:fs";

import axios from "axios";
import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

import {
  X_CASHTAG_LIMIT_MESSAGE,
  X_MAX_GIF_SIZE_BYTES,
  X_MAX_IMAGE_SIZE_BYTES,
  X_MAX_MEDIA_COUNT,
  X_MAX_VIDEO_SIZE_BYTES,
  X_STANDARD_POST_MAX_LENGTH,
  X_VALIDATION_RULES,
  getXTextLength,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { httpStatus, isTransientError, withTransientRetry } from "../../utils/transient-retry";
import { validateContentForPlatform } from "../../validation";
import { Publisher } from "../base";

import type { PostResult, RepostResult } from "../../types";
import type {
  PostOptions,
  Content,
  PostOptionsWithCredentials,
  QuoteTarget,
  RepostTarget,
  XCredentials,
} from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
}

interface XAuthenticatedUser {
  id?: string;
  username?: string;
  subscription_type?: string;
}

interface XMediaProcessingInfo {
  state?: "pending" | "in_progress" | "succeeded" | "failed";
  check_after_secs?: number;
  error?: { code?: number; name?: string; message?: string };
}

const X_MEDIA_PROCESSING_FALLBACK_DELAY_MS = 1000;
const X_MEDIA_PROCESSING_TIMEOUT_MS = 10 * 60_000;
const X_MEDIA_UPLOAD_CHUNK_BYTES = 1024 * 1024;
const X_MEDIA_REQUEST_TIMEOUT_MS = 30_000;
const X_MEDIA_CHUNK_TIMEOUT_MS = 120_000;

/** X monthly usage caps are hard product limits; a capped 429 cannot clear within a retry window. */
function isUsageCapExceeded(error: unknown): boolean {
  const data = (error as { data?: { title?: unknown; type?: unknown } } | undefined)?.data;
  if (data?.title === "UsageCapExceeded") return true;
  return typeof data?.type === "string" && data.type.endsWith("/usage-capped");
}

/**
 * Media preparation never publishes, so repeating it is safe. The dependency
 * reports its own request timeouts without a transport code, so they are
 * recognized here in addition to the shared transient classification.
 */
function shouldRetryMediaRequest(error: unknown): boolean {
  if (isUsageCapExceeded(error)) return false;
  const err = error as { type?: unknown; requestError?: { message?: unknown } } | undefined;
  return isTransientError(error) || (err?.type === "request" && err.requestError?.message === "Request timeout.");
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

  private cachedUsername?: string;

  private cachedSubscriptionType?: string;

  private authenticatedUserLookupAttempted = false;

  constructor(options?: PostOptionsWithCredentials) {
    super("X", options, "x");

    if (!options?.x?.credentials) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials");
    }

    this.credentials = options.x.credentials;
    this.cachedUserId = this.credentials.userId;
    this.cachedUsername = this.credentials.username?.replace(/^@/, "");

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

  private accountDetails(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      platform: "x",
      ...(this.cachedUsername ? { accountHandle: `@${this.cachedUsername}` } : {}),
      ...(this.cachedSubscriptionType ? { subscriptionType: this.cachedSubscriptionType } : {}),
      ...extra,
    };
  }

  private async resolveAuthenticatedUser(): Promise<XAuthenticatedUser> {
    const accessToken = this.getCurrentAccessToken();
    this.authenticatedUserLookupAttempted = true;
    const response = await axios.get<{ data?: XAuthenticatedUser }>("https://api.x.com/2/users/me", {
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        "user.fields": "username,subscription_type",
      },
    });
    const user = response.data?.data;
    if (!user?.id) {
      throw new PostError(PostErrorType.API_ERROR, "X API did not return the authenticated user profile.");
    }

    this.cachedUserId = user.id;
    this.cachedUsername = user.username?.replace(/^@/, "") || this.cachedUsername;
    this.cachedSubscriptionType = user.subscription_type || undefined;
    return user;
  }

  private async checkLongPostEligibility(textLength: number): Promise<void> {
    try {
      const user = await this.resolveAuthenticatedUser();
      if (user.subscription_type?.toLowerCase() !== "none") return;

      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `${this.cachedUsername ? `@${this.cachedUsername}` : "This X account"} does not have X Premium, so it cannot publish this post. X counts it as ${textLength} characters. Shorten it to ${X_STANDARD_POST_MAX_LENGTH} weighted characters or split it into a thread.`,
        this.accountDetails({
          code: "long_post_requires_premium",
          limit: X_STANDARD_POST_MAX_LENGTH,
          actual: textLength,
        }),
      );
    } catch (error) {
      if (error instanceof PostError && error.errorType === PostErrorType.INVALID_CONTENT) throw error;

      // An unavailable or unrecognized subscription result is not proof that
      // the account lacks Premium. Let X make the authoritative decision.
      this.logger.warn("Could not determine X Premium status; attempting the long post with X.");
    }
  }

  private async populateAccountIdentityForError(): Promise<void> {
    if (this.cachedUsername || this.authenticatedUserLookupAttempted) return;
    try {
      await this.resolveAuthenticatedUser();
    } catch {
      // The stored account id remains available to the scheduler when X can no
      // longer return a profile (for example, after credential revocation).
    }
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
          timeout: 30_000,
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

  /**
   * twitter-api-v2 stops polling when X returns pending/in_progress without a
   * positive check_after_secs value. X documents a one-second fallback for
   * that response, and attaching the ID before processing finishes produces
   * a misleading "Your media IDs are invalid" rejection.
   */
  private async waitForMediaProcessing(mediaId: string): Promise<void> {
    const deadline = Date.now() + X_MEDIA_PROCESSING_TIMEOUT_MS;

    while (true) {
      if (Date.now() >= deadline) {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "X did not finish processing the uploaded media within 10 minutes. Retry the post.",
          this.accountDetails({ code: "media_processing_timeout", mediaId }),
        );
      }

      let processingInfo: XMediaProcessingInfo | undefined;
      try {
        // Read-only status checks reuse the known media ID and the remaining processing budget.
        const response = await withTransientRetry(
          (remainingMs) =>
            this.client.v2.get(
              "media/upload",
              { command: "STATUS", media_id: mediaId },
              { timeout: Math.min(X_MEDIA_REQUEST_TIMEOUT_MS, remainingMs) },
            ),
          { deadline, shouldRetry: shouldRetryMediaRequest },
        );
        processingInfo = response.data.processing_info as XMediaProcessingInfo | undefined;
      } catch (error: unknown) {
        const status = httpStatus(error);
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "Could not confirm that X finished processing the uploaded media. Retry the post.",
          this.accountDetails({ code: "media_status_unavailable", mediaId, ...(status && { httpStatus: status }) }),
        );
      }

      // X omits processing_info when no asynchronous processing is required.
      if (!processingInfo || processingInfo.state === "succeeded") return;

      if (processingInfo.state === "failed") {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          "X could not process the uploaded media. Check the file before publishing again.",
          this.accountDetails({ code: "media_processing_failed", mediaId }),
        );
      }

      if (processingInfo.state !== "pending" && processingInfo.state !== "in_progress") {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "X returned an unrecognized media processing status. Retry the post.",
          this.accountDetails({ code: "media_status_unknown", mediaId }),
        );
      }

      const requestedDelayMs =
        typeof processingInfo.check_after_secs === "number" && processingInfo.check_after_secs > 0
          ? processingInfo.check_after_secs * 1000
          : X_MEDIA_PROCESSING_FALLBACK_DELAY_MS;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(requestedDelayMs, Math.max(0, deadline - Date.now()))),
      );
    }
  }

  /**
   * Chunked INIT/APPEND/FINALIZE over the authenticated v2 transport. The
   * dependency's uploadMedia polls processing recursively with no timeout or
   * abort option, so videos and GIFs use this bounded version and then
   * waitForMediaProcessing. Every request is capped by the remaining budget,
   * and once the budget is spent no further request is made.
   */
  private async uploadChunkedMedia(
    buffer: Buffer,
    mediaType: EUploadMimeType,
    mediaCategory: "tweet_gif" | "tweet_video",
    remainingMs: number,
  ): Promise<string> {
    const deadline = Date.now() + remainingMs;
    const boundedTimeout = (maxMs: number): { timeout: number } => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "X did not accept the media upload within 10 minutes. Retry the post.",
          this.accountDetails({ code: "media_upload_timeout" }),
        );
      }
      return { timeout: Math.min(maxMs, remaining) };
    };

    const init = await this.client.v2.post<{ data?: { id?: unknown } }>(
      "media/upload/initialize",
      { total_bytes: buffer.length, media_type: mediaType, media_category: mediaCategory },
      boundedTimeout(X_MEDIA_REQUEST_TIMEOUT_MS),
    );
    const mediaId = init?.data?.id;
    if (typeof mediaId !== "string" || !/^[\w-]{1,200}$/.test(mediaId)) {
      throw new PostError(
        PostErrorType.PREPARATION_ERROR,
        "X did not return a media ID for the upload. Retry the post.",
        this.accountDetails({ code: "media_upload_failed" }),
      );
    }
    const encodedId = encodeURIComponent(mediaId);

    const chunkCount = Math.ceil(buffer.length / X_MEDIA_UPLOAD_CHUNK_BYTES);
    for (let segmentIndex = 0; segmentIndex < chunkCount; segmentIndex += 1) {
      const offset = segmentIndex * X_MEDIA_UPLOAD_CHUNK_BYTES;
      await this.client.v2.post(
        `media/upload/${encodedId}/append`,
        // subarray shares memory with the loaded file instead of copying each chunk.
        { segment_index: segmentIndex, media: buffer.subarray(offset, offset + X_MEDIA_UPLOAD_CHUNK_BYTES) },
        { forceBodyMode: "form-data", ...boundedTimeout(X_MEDIA_CHUNK_TIMEOUT_MS) },
      );
    }

    await this.client.v2.post(
      `media/upload/${encodedId}/finalize`,
      undefined,
      boundedTimeout(X_MEDIA_REQUEST_TIMEOUT_MS),
    );
    return mediaId;
  }

  private async uploadMedia(resolvedPath: string): Promise<string> {
    // Check if the media file exists
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    const mimeType = XPublisher.getMimeType(resolvedPath);
    const buffer = fs.readFileSync(resolvedPath);

    const isGif = mimeType === EUploadMimeType.Gif;
    const isVideo = mimeType === EUploadMimeType.Mp4 || mimeType === EUploadMimeType.Mov;
    let maxSizeBytes = X_MAX_IMAGE_SIZE_BYTES;
    let mediaKind = "images";
    let errorCode = "image_too_large";
    if (isGif) {
      maxSizeBytes = X_MAX_GIF_SIZE_BYTES;
      mediaKind = "animated GIFs";
      errorCode = "gif_too_large";
    } else if (isVideo) {
      maxSizeBytes = X_MAX_VIDEO_SIZE_BYTES;
      mediaKind = "videos";
      errorCode = "video_too_large";
    }
    if (buffer.byteLength > maxSizeBytes) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `X ${mediaKind} cannot exceed ${Math.round(maxSizeBytes / (1024 * 1024))} MB. This file is ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB.`,
        {
          ...this.accountDetails(),
          code: errorCode,
          limit: maxSizeBytes,
          actual: buffer.byteLength,
        },
      );
    }

    // Upload the media using the X V2 API
    try {
      // Nothing is published before v2.tweet, so a repeated upload only creates
      // another media ID. A transient failure anywhere in INIT/APPEND/FINALIZE
      // restarts the whole upload (initial attempt plus two retries) within a
      // finite deadline. Images keep the dependency upload, which only polls
      // when X reports asynchronous processing for them.
      const mediaId = await withTransientRetry(
        (remainingMs) =>
          isGif || isVideo
            ? this.uploadChunkedMedia(buffer, mimeType, isGif ? "tweet_gif" : "tweet_video", remainingMs)
            : this.client.v2.uploadMedia(buffer, { media_type: mimeType }),
        { deadline: Date.now() + X_MEDIA_PROCESSING_TIMEOUT_MS, shouldRetry: shouldRetryMediaRequest },
      );

      // Once FINALIZE succeeded the ID is fixed: only poll it, never re-upload
      // because a status read failed. Verify the terminal state ourselves
      // before making the first request that can create a post.
      if (isGif || isVideo) await this.waitForMediaProcessing(mediaId);

      this.logger.info(`Media uploaded: ${mediaId}`);

      return mediaId;
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      // Never surface the raw dependency message: it can carry request URLs and tokens.
      const status = httpStatus(error);
      this.logger.error(`Failed to upload media to X${status ? ` (HTTP ${status})` : ""}.`);
      if (error instanceof Error && error.message.startsWith("Media processing failed")) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          "X could not process the uploaded media. Check the file before publishing again.",
          this.accountDetails({ code: "media_processing_failed" }),
        );
      }
      let errorType = PostErrorType.PREPARATION_ERROR;
      let message = "Failed to upload media to X. Retry the post.";
      let code = "media_upload_failed";
      if (status === 401) {
        errorType = PostErrorType.CREDENTIALS_ERROR;
        message = "X rejected the credentials used to upload media.";
      } else if (isUsageCapExceeded(error)) {
        errorType = PostErrorType.RATE_LIMIT_ERROR;
        message = "X reports that this app has reached its API usage cap. The media upload was not retried.";
        code = "usage_cap_exceeded";
      } else if (status === 429) {
        errorType = PostErrorType.RATE_LIMIT_ERROR;
        message = "X rate limited the media upload.";
      }
      throw new PostError(errorType, message, this.accountDetails({ code, ...(status && { httpStatus: status }) }));
    }
  }

  static validate(content: Content, options?: PostOptions["x"]): ValidationResult {
    return validateContentForPlatform("x", content, { x: options });
  }

  async postContent(
    content: Content,
    options?: PostOptionsWithCredentials,
    quoteTarget?: QuoteTarget,
  ): Promise<PostResult> {
    const replyToId = options?.x?.replyToId;

    // Validate the content
    const validation = XPublisher.validate(content, options?.x);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "X content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    // Ensure we have a valid token before posting
    await this.ensureValidToken();

    const textLength = getXTextLength(content.text ?? "");
    if (textLength > X_STANDARD_POST_MAX_LENGTH) {
      await this.checkLongPostEligibility(textLength);
    }

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
      await this.populateAccountIdentityForError();
      if (error instanceof PostError) {
        let details: Record<string, unknown> = {};
        if (typeof error.details === "object" && error.details !== null) {
          details = error.details as Record<string, unknown>;
        } else if (error.details !== undefined) {
          details = { provider: error.details };
        }
        throw new PostError(error.errorType, error.message, this.accountDetails(details));
      }

      const err = error as {
        code?: number;
        data?: { detail?: string; status?: number };
        response?: { status?: number };
        status?: number;
      };
      const status = err.code ?? err.status ?? err.response?.status ?? err.data?.status;
      if (err.data?.detail?.toLowerCase().includes("cashtag")) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          X_CASHTAG_LIMIT_MESSAGE,
          this.accountDetails({
            code: "too_many_cashtags",
            provider: err.data,
          }),
        );
      }
      if (status === 403 && textLength > X_STANDARD_POST_MAX_LENGTH) {
        const accountLabel = this.cachedUsername ? ` for @${this.cachedUsername}` : "";
        const reportedSubscription = this.cachedSubscriptionType
          ? ` X reports the account's subscription as ${this.cachedSubscriptionType}, but did not grant long-post access for this request.`
          : " The account may not have X Premium long-post access.";
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          `X rejected this post${accountLabel} (${textLength} weighted characters).${reportedSubscription} Shorten it to ${X_STANDARD_POST_MAX_LENGTH} weighted characters or split it into a thread.`,
          {
            ...this.accountDetails(),
            code: "long_post_not_permitted",
            limit: X_STANDARD_POST_MAX_LENGTH,
            actual: textLength,
            provider: err.data,
          },
        );
      }

      if (
        status === 403 &&
        err.data?.detail?.includes("You can only reply to or quote posts where you are mentioned or are the author")
      ) {
        throw new PostError(
          PostErrorType.PUBLISH_REJECTED,
          "X does not allow this reply or quote through its API: the original post must mention your account or be authored by you. Choose an eligible post, or publish a standalone post without a reply or quote target. Retrying the same target will not resolve this restriction.",
          this.accountDetails({ code: "reply_or_quote_not_permitted", provider: err.data }),
        );
      }

      // A response rejecting this single tweet request is conclusive. Network
      // failures and 5xx responses still have an uncertain publication outcome.
      if (status === 400 || status === 401 || status === 403 || status === 422 || status === 429) {
        let errorType = PostErrorType.PUBLISH_REJECTED;
        if (status === 401) errorType = PostErrorType.CREDENTIALS_ERROR;
        if (status === 429) errorType = PostErrorType.RATE_LIMIT_ERROR;
        throw new PostError(
          errorType,
          `X rejected the post (${status}): ${err.data?.detail ?? "Check the content and account permissions before retrying."}`,
          this.accountDetails({ provider: err.data }),
        );
      }

      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post content: ${error}`,
        this.accountDetails({ provider: err.data }),
      );
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

    const authenticatedUser = await this.resolveAuthenticatedUser();
    const userId = authenticatedUser.id;
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
          timeout: 30_000,
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
