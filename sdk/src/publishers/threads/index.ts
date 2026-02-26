import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const THREADS_API_VERSION = "v1.0";
const MAX_TEXT_LENGTH = 500;
const MAX_MEDIA_COUNT = 1;
const PROCESSING_POLL_INTERVAL = 2000;
const PROCESSING_MAX_ATTEMPTS = 12;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: MAX_TEXT_LENGTH },
  media: { maxCount: MAX_MEDIA_COUNT, maxImages: 1, maxVideos: 1, allowsMixed: false },
};

export class ThreadsPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private userId: string;
  private accessToken: string;
  private s3MediaUploader: S3MediaUploader | null = null;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptionsWithCredentials) {
    super("Threads", options);

    if (!options?.threads?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Threads credentials are required in options.threads.credentials",
      );
    }

    const { accessToken, userId } = options.threads.credentials;
    this.accessToken = accessToken;
    this.userId = userId;

    this.client = axios.create({
      baseURL: `https://graph.threads.net/${THREADS_API_VERSION}`,
      timeout: 30_000,
      headers: {
        "Content-Type": "application/json",
      },
    });
    // S3MediaUploader is lazily initialized only when media upload is needed
  }

  private async cleanupS3Files(): Promise<void> {
    if (this.s3MediaUploader && this.s3TempFileKeys.length > 0) {
      await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader!.deleteFile(key)));
    }
  }

  private async waitForMediaReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < PROCESSING_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.client.get(`/${containerId}`, {
        params: {
          fields: "status",
          access_token: this.accessToken,
        },
      });

      const status = response.data?.status;
      if (!status || status === "FINISHED" || status === "READY") {
        return;
      }

      if (status === "ERROR") {
        throw new PostError(
          PostErrorType.API_ERROR,
          `Threads media container ${containerId} creation failed.`,
          response.data,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_INTERVAL));
    }

    throw new PostError(PostErrorType.API_ERROR, "Threads media processing timed out.");
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    let videos = 0;
    for (const item of media) {
      if (item.type === "video") videos += 1;
    }

    if (!text.trim() && mediaCount === 0) {
      errors.push({
        platform: "threads",
        severity: "error",
        code: "content_required",
        message: "Threads posts require text or media.",
        field: "text",
      });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      errors.push({
        platform: "threads",
        severity: "error",
        code: "text_too_long",
        message: `Threads text cannot exceed ${MAX_TEXT_LENGTH} characters.`,
        field: "text",
        limit: MAX_TEXT_LENGTH,
        actual: text.length,
      });
    }

    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "threads",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    if (videos > 1) {
      errors.push({
        platform: "threads",
        severity: "error",
        code: "too_many_videos",
        message: "Threads supports only one video per post.",
        field: "media",
        limit: 1,
        actual: videos,
      });
    }

    if (mediaCount > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "threads",
        severity: "warning",
        code: "too_many_media",
        message: "Threads supports only one media item per post. Only the first will be posted.",
        field: "media",
        limit: MAX_MEDIA_COUNT,
        actual: mediaCount,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
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
    const response = await this.client.get("/me", {
      params: { fields: "id", access_token: this.accessToken },
    });
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

  async postContent(content: Content): Promise<PostResult> {
    const validation = ThreadsPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Threads content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const media = content.media?.[0];

    try {
      // Resolve user ID from /me - the stored ID may not match what the publish API expects
      let threadsUserId: string;
      try {
        threadsUserId = await this.resolveUserId();
      } catch (resolveError) {
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

      const createResponse = await this.client.post(`/${threadsUserId}/threads`, basePayload);
      const creationId = createResponse.data?.id || createResponse.data?.creation_id;

      if (!creationId) {
        throw new PostError(PostErrorType.API_ERROR, "Threads API did not return a creation id.");
      }

      if (media?.type === "video") {
        await this.waitForMediaReady(creationId);
      }

      const publishResponse = await this.client.post(`/${threadsUserId}/threads_publish`, {
        access_token: this.accessToken,
        creation_id: creationId,
      });

      return {
        id: publishResponse.data?.id || publishResponse.data?.post_id || creationId,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
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
