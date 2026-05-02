import axios, { type AxiosError, type AxiosInstance } from "axios";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";

const INSTAGRAM_API_VERSION = "v25.0";
const FACEBOOK_GRAPH_API_VERSION = "v24.0";
const MAX_CAPTION_LENGTH = 2200;
const MAX_MEDIA_COUNT = 10;
const PROCESSING_POLL_INTERVAL = 3000;
const PROACTIVE_REFRESH_DAYS = 7;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: MAX_CAPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxCount: MAX_MEDIA_COUNT, allowsMixed: true },
};

interface InstagramRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class InstagramPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private businessAccountId: string;
  private accessToken: string;
  private expiresAt?: number;
  private graphApi: "instagram" | "facebook";

  private s3MediaUploader: S3MediaUploader;
  private s3TempFileKeys: string[] = [];

  private refreshedCredentials?: {
    accessToken: string;
    expiresAt: number;
  };

  constructor(options?: PostOptionsWithCredentials) {
    super("Instagram", options);

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

      const response = await axios.get<InstagramRefreshResponse>(url.toString());
      const { access_token, expires_in } = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

      this.refreshedCredentials = { accessToken: access_token, expiresAt };
      this.accessToken = access_token;
      this.expiresAt = expiresAt;

      this.client.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      this.logger.info("Instagram access token refreshed successfully");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(`Failed to refresh Instagram token: ${err.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram access token has expired. Please reconnect your Instagram account in account settings.",
        err.response?.data?.error?.message || err.message,
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

  private async apiRequest<T>(method: "get" | "post", url: string, data?: unknown): Promise<{ data: T }> {
    const doRequest = () => {
      const requestUrl = this.withAccessToken(url);
      return method === "get" ? this.client.get<T>(requestUrl) : this.client.post<T>(requestUrl, data);
    };

    try {
      return await doRequest();
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: { message?: string } }>;
      if (axiosError.response?.status === 401 && this.graphApi === "instagram") {
        this.logger.warn("Received 401, attempting token refresh...");
        await this.refreshAccessToken();
        return doRequest();
      }
      throw error;
    }
  }

  private async cleanupS3Files(): Promise<void> {
    await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader.deleteFile(key)));
  }

  private async waitForMediaReady(containerId: string): Promise<void> {
    while (true) {
      const statusRes = await this.apiRequest<{ status_code: string; status: string }>(
        "get",
        `/${containerId}?fields=status_code,status`,
      );
      const statusCode = statusRes.data.status_code;
      const status = statusRes.data.status;

      if (statusCode === "FINISHED") return;

      if (statusCode === "ERROR")
        throw new PostError(
          PostErrorType.API_ERROR,
          `Instagram media container ${containerId} creation failed: ${status}`,
        );

      await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_INTERVAL));
    }
  }

  private async createMediaObject(media: Media, isCarousel: boolean, caption?: string): Promise<string> {
    // Get the Instagram media type
    const mediaType = media.type === "video" ? "REELS" : undefined;

    // Resolve media to a public URL (uses URL directly or uploads to S3)
    const { url: mediaUrl, uploadedKey } = await resolveMediaUrl(media, (filePath, key) =>
      this.s3MediaUploader.uploadFile(filePath, key),
    );

    if (uploadedKey) {
      this.s3TempFileKeys.push(uploadedKey);
      this.logger.info(`Media uploaded to S3: ${mediaUrl}`);
    } else {
      this.logger.info(`Using provided URL: ${mediaUrl}`);
    }

    try {
      // Create media object using the URL
      const response = await this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media`, {
        media_type: mediaType,
        caption: isCarousel ? undefined : caption,
        is_carousel_item: isCarousel,
        ...(media.type === "video" ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      });

      return response.data.id;
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { data?: { error?: { message?: string } } } };
      this.logger.error(error instanceof Error ? error : String(error));
      const apiMessage = err.response?.data?.error?.message || err.message || "Unknown error";

      throw new PostError(PostErrorType.API_ERROR, `Failed to create media object: ${apiMessage}`, err);
    }
  }

  private async createMediaContainer(content: Content): Promise<string> {
    // Create containers for each object
    const mediaObjectIds: string[] = [];
    for (const media of content.media!) {
      const mediaObjectId = await this.createMediaObject(media, content.media!.length > 1, content.text);
      mediaObjectIds.push(mediaObjectId);
    }

    try {
      // Create the final container
      let containerId: string = mediaObjectIds[0];

      // If there are multiple media objects, create a carousel post
      if (content.media!.length > 1) {
        const response = await this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media`, {
          media_type: "CAROUSEL",
          caption: content.text,
          children: mediaObjectIds.join(","),
        });

        containerId = response.data.id;
      }

      return containerId;
    } catch (error: unknown) {
      const err = error as { message?: string };
      this.logger.error(error instanceof Error ? error : String(error));

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to create media container: ${err.message || "Unknown error"}`,
        err,
      );
    }
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    // Check for required media
    if (mediaCount === 0) {
      errors.push({
        platform: "instagram",
        severity: "error",
        code: "media_required",
        message: "Instagram posts require at least one media item.",
        field: "media",
      });
    }

    // Check caption length
    if (text.length > MAX_CAPTION_LENGTH) {
      errors.push({
        platform: "instagram",
        severity: "error",
        code: "caption_too_long",
        message: `Instagram captions cannot exceed ${MAX_CAPTION_LENGTH} characters.`,
        field: "text",
        limit: MAX_CAPTION_LENGTH,
        actual: text.length,
      });
    }

    // Check media sources
    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "instagram",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    // Warn about excess media
    if (mediaCount > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "instagram",
        severity: "warning",
        code: "too_many_media",
        message: `Instagram supports up to ${MAX_MEDIA_COUNT} media items. Only the first ${MAX_MEDIA_COUNT} will be posted.`,
        field: "media",
        limit: MAX_MEDIA_COUNT,
        actual: mediaCount,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  async postContent(content: Content, _options: PostOptionsWithCredentials): Promise<PostResult> {
    await this.ensureValidToken();

    // Validate the content
    const validation = InstagramPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }
    const normalizedContent: Content = {
      ...content,
      media: content.media ? content.media.slice(0, MAX_MEDIA_COUNT) : undefined,
    };

    try {
      // Create media container
      const containerId = await this.createMediaContainer(normalizedContent);

      // Wait for the container to be ready
      await this.waitForMediaReady(containerId);

      // Publish the container
      const response = await this.apiRequest<{ id: string }>("post", `/${this.businessAccountId}/media_publish`, {
        creation_id: containerId,
      });

      const result: PostResult = { id: response.data.id, error: PostErrorType.NO_ERROR };
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
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      if (error instanceof PostError) throw error;

      this.logger.error(error instanceof Error ? error : String(error));

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish post: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err,
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
