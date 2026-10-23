import axios, { type AxiosError, type AxiosInstance } from "axios";

import { INSTAGRAM_MAX_MEDIA_COUNT, INSTAGRAM_VALIDATION_RULES } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { isTransientError, withTransientRetry } from "../../utils/transient-retry";
import { validateContentForPlatform } from "../../validation";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { PostOptions, Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

const INSTAGRAM_API_VERSION = "v25.0";
const FACEBOOK_GRAPH_API_VERSION = "v25.0";
const PROCESSING_POLL_INTERVAL = 3000;
const PROCESSING_DEADLINE_MS = 600_000;
const PROACTIVE_REFRESH_DAYS = 7;
// Retry only Meta's explicit missing-media rejection, always using the same container ID.
const PUBLISH_PROPAGATION_DELAYS = [5000, 10_000, 20_000];
// Staging, container creation and status reads never publish, so repeating them
// cannot duplicate a post. The budget caps the total number of such retries per
// post across every child, the carousel container and every status read.
const PREPARATION_RETRY_BUDGET = 6;
// Provider text in messages and diagnostics is redacted and then cut to this length.
const MAX_DIAGNOSTIC_TEXT_LENGTH = 300;

type InstagramPhase = "stage_media" | "create_media" | "create_carousel" | "processing" | "publish";

interface InstagramProviderError {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
  fbtrace_id?: string;
  is_transient?: boolean;
}

interface InstagramPublishErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: InstagramProviderError;
    };
  };
  code?: unknown;
  message?: string;
}

/** Safe diagnostic fields only: never Axios config/request objects, media URLs or tokens. */
interface InstagramDiagnostic {
  phase: InstagramPhase;
  containerId?: string;
  httpStatus?: number;
  networkCode?: string;
  statusCode?: string;
  status?: string;
  error?: InstagramProviderError;
}

interface InstagramRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class InstagramPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  static getValidationRules(): PlatformValidationRules {
    return INSTAGRAM_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private businessAccountId: string;
  private accessToken: string;
  private expiresAt?: number;
  private graphApi: "instagram" | "facebook";

  private s3MediaUploader: S3MediaUploader;
  private s3TempFileKeys: string[] = [];
  private preparationRetriesLeft = PREPARATION_RETRY_BUDGET;

  private refreshedCredentials?: {
    accessToken: string;
    expiresAt: number;
  };

  constructor(options?: PostOptionsWithCredentials) {
    super("Instagram", options, "instagram");

    // Validate the credentials
    if (!options?.instagram?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram credentials are required in options.instagram.credentials",
      );
    }
    const { accessToken, businessAccountId, expiresAt, graphApi } = options.instagram.credentials;
    this.businessAccountId = businessAccountId;
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
    this.graphApi = graphApi ?? "instagram";

    // Create axios client - graph.instagram.com for Instagram Login tokens, graph.facebook.com for Page access tokens
    const baseURL =
      this.graphApi === "facebook"
        ? `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}`
        : `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`;
    this.client = axios.create({
      baseURL,
      timeout: 30_000, // 30 seconds timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/json",
        ...(this.graphApi === "instagram" ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    // Create S3 media uploader
    this.s3MediaUploader = new S3MediaUploader();
  }

  private isTokenExpiringSoon(): boolean {
    if (!this.expiresAt) return false;
    const now = Math.floor(Date.now() / 1000);
    const sevenDays = PROACTIVE_REFRESH_DAYS * 24 * 60 * 60;
    return now >= this.expiresAt - sevenDays;
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.graphApi !== "instagram") {
      return;
    }
    const currentToken = this.refreshedCredentials?.accessToken || this.accessToken;

    try {
      this.logger.info("Refreshing Instagram access token...");

      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", currentToken);

      const response = await axios.get<InstagramRefreshResponse>(url.toString(), { timeout: 30_000 });
      const { access_token, expires_in } = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

      this.refreshedCredentials = { accessToken: access_token, expiresAt };
      this.accessToken = access_token;
      this.expiresAt = expiresAt;

      this.client.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      this.logger.info("Instagram access token refreshed successfully");
    } catch (error: unknown) {
      this.throwIfCredentialRevoked(error);
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(`Failed to refresh Instagram token: ${this.redact(err.message || String(error))}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram access token has expired. Please reconnect your Instagram account in account settings.",
        this.redact(err.response?.data?.error?.message || err.message || ""),
      );
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.graphApi === "instagram" && this.isTokenExpiringSoon()) {
      await this.refreshAccessToken();
    }
  }

  private withAccessToken(url: string): string {
    if (this.graphApi !== "facebook") {
      return url;
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access_token=${encodeURIComponent(this.accessToken)}`;
  }

  /** `deadline` bounds each attempt's HTTP timeout so a request never outlives it, even after a token refresh. */
  private async apiRequest<T>(
    method: "get" | "post",
    url: string,
    data?: unknown,
    deadline?: number,
  ): Promise<{ data: T }> {
    const doRequest = () => {
      const requestUrl = this.withAccessToken(url);
      if (deadline === undefined) {
        return method === "get" ? this.client.get<T>(requestUrl) : this.client.post<T>(requestUrl, data);
      }
      if (Date.now() >= deadline) {
        throw new PostError(PostErrorType.PREPARATION_ERROR, "Instagram media processing timed out.");
      }
      const config = { timeout: Math.min(30_000, deadline - Date.now()) };
      return method === "get" ? this.client.get<T>(requestUrl, config) : this.client.post<T>(requestUrl, data, config);
    };

    try {
      return await doRequest();
    } catch (error) {
      // Revoked sessions cannot be repaired by refreshing; retain the diagnosis without exposing request data.
      this.throwIfCredentialRevoked(error);
      const axiosError = error as AxiosError<{ error?: { message?: string } }>;
      if (axiosError.response?.status === 401 && this.graphApi === "instagram") {
        this.logger.warn("Received 401, attempting token refresh...");
        await this.refreshAccessToken();
        return doRequest();
      }
      throw error;
    }
  }

  /** Removes the access token and any URL (which can carry tokens or media locations) and bounds the length. */
  private redact(text: string): string {
    return text
      .split(this.accessToken || "\0")
      .join("[redacted]")
      .split(this.refreshedCredentials?.accessToken || "\0")
      .join("[redacted]")
      .replaceAll(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
      .replaceAll(/((?:access[_-]?token|authorization)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;&]+/gi, "$1[redacted]")
      .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
  }

  private providerError(error: unknown): InstagramProviderError | undefined {
    const raw = (error as InstagramPublishErrorLike | undefined)?.response?.data?.error;
    if (!raw || typeof raw !== "object") return undefined;
    return {
      ...(typeof raw.code === "number" && { code: raw.code }),
      ...(typeof raw.error_subcode === "number" && { error_subcode: raw.error_subcode }),
      ...(typeof raw.type === "string" && /^[A-Za-z]{1,64}$/.test(raw.type) && { type: raw.type }),
      ...(typeof raw.message === "string" && { message: this.redact(raw.message) }),
      ...(typeof raw.fbtrace_id === "string" &&
        /^[\w-]{1,200}$/.test(raw.fbtrace_id) && { fbtrace_id: raw.fbtrace_id }),
      ...(typeof raw.is_transient === "boolean" && { is_transient: raw.is_transient }),
    };
  }

  private diagnostic(error: unknown, context: { phase: InstagramPhase; containerId?: string }): InstagramDiagnostic {
    const err = error as InstagramPublishErrorLike | undefined;
    const providerError = this.providerError(error);
    return {
      ...context,
      ...(typeof err?.response?.status === "number" && { httpStatus: err.response.status }),
      ...(typeof err?.code === "string" && /^[A-Z_]{1,40}$/.test(err.code) && { networkCode: err.code }),
      ...(providerError && { error: providerError }),
    };
  }

  private failureMessage(error: unknown): string {
    const err = error as InstagramPublishErrorLike | undefined;
    return this.redact(err?.response?.data?.error?.message || err?.message || "Unknown error");
  }

  /**
   * Retry predicate for operations that happen strictly before media_publish.
   * Known transient transport/HTTP failures and Meta's explicit is_transient
   * flag qualify; credential errors (already converted to PostError) and
   * ordinary rejections never do. The shared per-post budget caps the total.
   */
  private retryPreparation(error: unknown): boolean {
    const transient =
      error instanceof PostError
        ? this.isTransientStagingError(error)
        : isTransientError(error) || this.providerError(error)?.is_transient === true;
    if (!transient || this.preparationRetriesLeft <= 0) return false;
    this.preparationRetriesLeft -= 1;
    return true;
  }

  /** S3 upload failures are wrapped by the uploader; inspect the retained SDK error for transient causes. */
  private isTransientStagingError(error: PostError): boolean {
    if (error.errorType !== PostErrorType.API_ERROR) return false;
    const cause = error.details as
      | { $metadata?: { httpStatusCode?: number }; code?: unknown; name?: unknown; $retryable?: unknown }
      | undefined;
    if (!cause || typeof cause !== "object") return /timed out uploading/i.test(error.message);
    return (
      isTransientError({ response: { status: cause.$metadata?.httpStatusCode }, code: cause.code }) ||
      cause.$retryable !== undefined ||
      cause.name === "TimeoutError" ||
      cause.name === "NetworkingError" ||
      /timed out uploading/i.test(error.message)
    );
  }

  /**
   * Fetches the public permalink for a freshly-published Instagram media id.
   *
   * The Graph API may briefly omit `permalink` while the post is being
   * indexed right after `media_publish`, so we retry a few times. Returns
   * `undefined` if the permalink cannot be obtained — callers should treat
   * the URL as unavailable rather than fabricating one from the numeric id.
   */
  private async fetchPermalinkWithRetry(mediaId: string): Promise<string | undefined> {
    const maxAttempts = 5;
    const delayMs = 1500;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const permalinkRes = await this.apiRequest<{ permalink?: string }>("get", `/${mediaId}?fields=permalink`);
        if (permalinkRes.data.permalink) {
          return permalinkRes.data.permalink;
        }
      } catch (permalinkError) {
        this.logger.warn(
          `Failed to fetch Instagram permalink (attempt ${attempt + 1}/${maxAttempts}): ${this.failureMessage(permalinkError)}`,
        );
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.warn(`Instagram permalink unavailable after ${maxAttempts} attempts for media ${mediaId}`);
    return undefined;
  }

  private async cleanupS3Files(): Promise<void> {
    await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader.deleteFile(key)));
  }

  /**
   * Polls one container until Meta reports it FINISHED. A transient status
   * read is repeated against the same container within the remaining deadline;
   * nothing is uploaded or created again. Terminal states fail immediately.
   * Neither a status read nor a poll sleep outlives the processing deadline.
   */
  private async waitForMediaReady(containerId: string): Promise<void> {
    const deadline = Date.now() + PROCESSING_DEADLINE_MS;
    while (Date.now() < deadline) {
      const statusRes = await withTransientRetry(
        () =>
          this.apiRequest<{ status_code?: string; status?: string }>(
            "get",
            `/${containerId}?fields=status_code,status`,
            undefined,
            deadline,
          ),
        { deadline, shouldRetry: (error) => this.retryPreparation(error) },
      );
      const statusCode = statusRes.data.status_code;
      const status = statusRes.data.status;

      if (statusCode === "FINISHED") return;

      if (statusCode === "ERROR" || statusCode === "EXPIRED")
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          `Instagram media container ${containerId} creation failed: ${this.redact(status ?? statusCode)}`,
          {
            phase: "processing",
            containerId,
            statusCode,
            ...(typeof status === "string" && { status: this.redact(status) }),
          } satisfies InstagramDiagnostic,
        );

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(PROCESSING_POLL_INTERVAL, Math.max(0, deadline - Date.now()))),
      );
    }
    throw new PostError(
      PostErrorType.PREPARATION_ERROR,
      `Instagram media container ${containerId} processing timed out after 10 minutes.`,
      { phase: "processing", containerId } satisfies InstagramDiagnostic,
    );
  }

  private async publishContainer(containerId: string): Promise<{ data: { id: string } }> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media_publish`, {
          creation_id: containerId,
        });
      } catch (error) {
        const err = error as InstagramPublishErrorLike;
        const providerError = err.response?.data?.error;
        // FINISHED can precede visibility to media_publish. Meta explicitly
        // rejects this request before publication, so retrying the same
        // creation_id is safe. Other failures may be ambiguous and must not
        // trigger another publish automatically.
        if (err.response?.status !== 400 || providerError?.code !== 9007 || providerError.error_subcode !== 2_207_027) {
          throw error;
        }

        const delay = PUBLISH_PROPAGATION_DELAYS[attempt];
        if (delay === undefined) {
          throw new PostError(
            PostErrorType.PUBLISH_REJECTED,
            "Instagram could not find the prepared media after waiting for it to become available. Please retry the failed Instagram target.",
            this.diagnostic(error, { phase: "publish", containerId }),
          );
        }

        this.logger.warn(
          `Instagram container ${containerId} is not visible to publishing yet; retrying in ${delay}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        // Do not create a replacement container or re-run the whole post.
      }
    }
  }

  private async stageMedia(media: Media): Promise<string> {
    try {
      // Resolve media to a public URL (uses URL directly or uploads to S3).
      // A failed upload is repeated with the same key; nothing is published here.
      const { url: mediaUrl, uploadedKey } = await resolveMediaUrl(media, (filePath, key) =>
        withTransientRetry(() => this.s3MediaUploader.uploadFile(filePath, key), {
          shouldRetry: (error) => this.retryPreparation(error),
        }),
      );

      // Never log the media URL: it may carry signed query tokens.
      if (uploadedKey) {
        this.s3TempFileKeys.push(uploadedKey);
        this.logger.info("Media uploaded to S3 for Instagram");
      } else {
        this.logger.info("Using provided media URL for Instagram");
      }
      return mediaUrl;
    } catch (error: unknown) {
      if (
        error instanceof PostError &&
        [PostErrorType.CREDENTIALS_ERROR, PostErrorType.INVALID_CONTENT].includes(error.errorType)
      ) {
        throw error;
      }
      const message = this.redact(error instanceof Error ? error.message : String(error));
      this.logger.error(`Instagram media staging failed: ${message}`);
      throw new PostError(PostErrorType.PREPARATION_ERROR, message, {
        phase: "stage_media",
      } satisfies InstagramDiagnostic);
    }
  }

  private async createMediaObject(media: Media, isCarousel: boolean, caption?: string): Promise<string> {
    // Get the Instagram media type
    // Standalone videos are Reels, while a video inside a carousel is a
    // carousel video child. Meta rejects a REELS child in a mixed carousel.
    const mediaType = media.type === "video" ? (isCarousel ? "VIDEO" : "REELS") : undefined;

    const mediaUrl = await this.stageMedia(media);

    try {
      // Create media object using the URL. A container is not a post, so a
      // transient failure here can safely be retried (an orphaned container
      // created by a lost response simply expires).
      const response = await withTransientRetry(
        () =>
          this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media`, {
            media_type: mediaType,
            caption: isCarousel ? undefined : caption,
            is_carousel_item: isCarousel,
            ...(media.type === "video" ? { video_url: mediaUrl } : { image_url: mediaUrl }),
          }),
        { shouldRetry: (error) => this.retryPreparation(error) },
      );

      return response.data.id;
    } catch (error: unknown) {
      this.throwIfCredentialRevoked(error);
      if (error instanceof PostError && error.errorType === PostErrorType.CREDENTIALS_ERROR) throw error;
      const apiMessage = this.failureMessage(error);
      this.logger.error(`Failed to create Instagram media object: ${apiMessage}`);

      throw new PostError(
        PostErrorType.PREPARATION_ERROR,
        `Failed to create media object: ${apiMessage}`,
        this.diagnostic(error, { phase: "create_media" }),
      );
    }
  }

  private async createMediaContainer(content: Content): Promise<string> {
    // Create containers for each object
    const mediaObjectIds: string[] = [];
    for (const media of content.media!) {
      const mediaObjectId = await this.createMediaObject(media, content.media!.length > 1, content.text);
      // A carousel cannot reference a video child that is still processing.
      if (content.media!.length > 1 && media.type === "video") await this.waitForMediaReady(mediaObjectId);
      mediaObjectIds.push(mediaObjectId);
    }

    try {
      // Create the final container
      let containerId: string = mediaObjectIds[0];

      // If there are multiple media objects, create a carousel post
      if (content.media!.length > 1) {
        const response = await withTransientRetry(
          () =>
            this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media`, {
              media_type: "CAROUSEL",
              caption: content.text,
              children: mediaObjectIds.join(","),
            }),
          { shouldRetry: (error) => this.retryPreparation(error) },
        );

        containerId = response.data.id;
      }

      return containerId;
    } catch (error: unknown) {
      this.throwIfCredentialRevoked(error);
      if (error instanceof PostError && error.errorType === PostErrorType.CREDENTIALS_ERROR) throw error;
      const apiMessage = this.failureMessage(error);
      this.logger.error(`Failed to create Instagram carousel container: ${apiMessage}`);

      throw new PostError(
        PostErrorType.PREPARATION_ERROR,
        `Failed to create media container: ${apiMessage}`,
        this.diagnostic(error, { phase: "create_carousel" }),
      );
    }
  }

  static validate(content: Content, options?: PostOptions["instagram"]): ValidationResult {
    return validateContentForPlatform("instagram", content, { instagram: options });
  }

  async postContent(content: Content, _options: PostOptionsWithCredentials): Promise<PostResult> {
    await this.ensureValidToken();

    // Validate the content
    const validation = InstagramPublisher.validate(content, _options?.instagram);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }
    const normalizedContent: Content = {
      ...content,
      media: content.media ? content.media.slice(0, INSTAGRAM_MAX_MEDIA_COUNT) : undefined,
    };

    this.preparationRetriesLeft = PREPARATION_RETRY_BUDGET;
    // Everything before media_publish is preparation: failing there cannot have
    // published anything. Once media_publish has been sent, an unknown failure
    // (timeout, dropped connection) must stay an uncertain API_ERROR.
    let publishSubmitted = false;
    let containerId: string | undefined;

    try {
      // Create media container
      containerId = await this.createMediaContainer(normalizedContent);

      // Wait for the container to be ready
      await this.waitForMediaReady(containerId);

      // Publish the container
      publishSubmitted = true;
      const response = await this.publishContainer(containerId);

      const result: PostResult = { id: response.data.id, error: PostErrorType.NO_ERROR };

      // Fetch the canonical permalink. Instagram post URLs require shortcodes
      // that are not derivable from the numeric media ID, so we have to ask
      // the API. Immediately after media_publish the permalink can briefly
      // be missing while the post is being indexed, so retry a few times
      // with a small backoff. Best-effort — failures here should not fail
      // the publish.
      result.url = await this.fetchPermalinkWithRetry(response.data.id);

      if (this.refreshedCredentials) {
        result.extraData = {
          refreshedCredentials: {
            accessToken: this.refreshedCredentials.accessToken,
            expiresAt: this.refreshedCredentials.expiresAt,
          },
        };
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;

      this.throwIfCredentialRevoked(error);

      const message = this.failureMessage(error);
      this.logger.error(`Failed to publish Instagram post: ${message}`);

      throw new PostError(
        publishSubmitted ? PostErrorType.API_ERROR : PostErrorType.PREPARATION_ERROR,
        `Failed to publish post: ${message}`,
        this.diagnostic(error, { phase: publishSubmitted ? "publish" : "processing", containerId }),
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
