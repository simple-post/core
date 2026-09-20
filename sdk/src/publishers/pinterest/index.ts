import fs from "node:fs";
import { readFile } from "node:fs/promises";

import axios from "axios";
import FormData from "form-data";

import { PINTEREST_MAX_TITLE_LENGTH, PINTEREST_VALIDATION_RULES, validatePinterestContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, resolveMediaUrl, TempFileManager } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { validateContentForPlatform } from "../../validation";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { PostOptions, Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

interface PinterestMediaResponse {
  media_id: string;
  upload_url?: string;
  upload_parameters?: Record<string, string>;
}

interface PinterestApiError {
  message?: string;
  response?: {
    status?: number;
    data?: { code?: number | string; message?: string };
    headers?: unknown;
  };
}

interface PinterestPin {
  id?: string;
  created_at?: string;
  board_id?: string;
  is_owner?: boolean;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  alt_text?: string | null;
}

interface PinterestPinListResponse {
  items?: PinterestPin[];
}

type PinterestCreatePayload = {
  board_id: string;
  media_source: Record<string, unknown>;
  title?: string;
  description?: string;
  link?: string;
  alt_text?: string;
};

const MEDIA_POLL_INTERVAL = 2000;
const MEDIA_POLL_MAX_ATTEMPTS = 150;
const TRANSIENT_CREATE_ERROR_CODE = 2787;
// Poll at 2, 5 and 10 seconds after the failed response. The cumulative
// window gives Pinterest time to expose a Pin created before the error.
const CREATE_RECONCILIATION_DELAYS_MS = [2000, 3000, 5000];
const CREATE_RECONCILIATION_CLOCK_SKEW_MS = 5000;

function responseHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const getter = (headers as { get?: (header: string) => unknown }).get;
  const value =
    typeof getter === "function"
      ? getter.call(headers, name)
      : (headers as Record<string, unknown>)[name.toLowerCase()];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function pinterestErrorDetails(error: PinterestApiError): Record<string, unknown> {
  const headers = error.response?.headers;
  return {
    provider: "pinterest",
    status: error.response?.status,
    code: error.response?.data?.code,
    message: error.response?.data?.message ?? error.message,
    requestId:
      responseHeader(headers, "x-pinterest-rid") ??
      responseHeader(headers, "x-request-id") ??
      responseHeader(headers, "x-amzn-requestid"),
    retryAfter: responseHeader(headers, "retry-after"),
    rateLimitLimit: responseHeader(headers, "x-ratelimit-limit"),
    rateLimitRemaining: responseHeader(headers, "x-ratelimit-remaining"),
    rateLimitReset: responseHeader(headers, "x-ratelimit-reset"),
  };
}

function isTransientCreateError(error: PinterestApiError): boolean {
  return error.response?.status === 400 && Number(error.response.data?.code) === TRANSIENT_CREATE_ERROR_CODE;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class PinterestPublisher extends Publisher {
  static readonly mediaRequirement = "either" as const;

  static getValidationRules(): PlatformValidationRules {
    return PINTEREST_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private accessToken: string;
  private s3MediaUploader: S3MediaUploader | null = null;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptionsWithCredentials) {
    super("Pinterest", options, "pinterest");

    if (!options?.pinterest?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Pinterest credentials are required in options.pinterest.credentials",
      );
    }

    const { accessToken } = options.pinterest.credentials;
    this.accessToken = accessToken;

    this.client = axios.create({
      baseURL: "https://api.pinterest.com/v5",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    // S3MediaUploader is lazily initialized only when needed for image uploads
  }

  private async cleanupS3Files(): Promise<void> {
    if (this.s3MediaUploader && this.s3TempFileKeys.length > 0) {
      await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader!.deleteFile(key)));
    }
  }

  private validateOptions(options?: PostOptionsWithCredentials): asserts options is PostOptionsWithCredentials & {
    pinterest: { boardId: string };
  } {
    if (!options?.pinterest?.boardId?.trim()) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Pinterest boardId is required in options.pinterest.boardId");
    }
  }

  private async createVideoMedia(resolvedPath: string): Promise<string> {
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    const registerResponse = await this.client.post<PinterestMediaResponse>("/media", {
      media_type: "video",
    });

    const { media_id, upload_url } = registerResponse.data;

    if (!media_id || !upload_url) {
      throw new PostError(PostErrorType.API_ERROR, "Pinterest did not return media upload information.");
    }

    try {
      const formData = new FormData();
      for (const [key, value] of Object.entries(registerResponse.data.upload_parameters ?? {}))
        formData.append(key, value);
      formData.append("file", fs.createReadStream(resolvedPath));
      await axios.post(upload_url, formData, {
        timeout: 600_000,
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to upload Pinterest video: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }

    let lastStatus = "unknown";
    for (let attempt = 0; attempt < MEDIA_POLL_MAX_ATTEMPTS; attempt += 1) {
      const statusResponse = await this.client.get(`/media/${media_id}`);
      const status = String(statusResponse.data?.status ?? "").toLowerCase();
      lastStatus = status || "unknown";
      if (status === "succeeded") return media_id;
      if (["failed", "error", "rejected"].includes(status))
        throw new PostError(PostErrorType.API_ERROR, `Pinterest video media ${media_id} failed processing.`);
      await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_INTERVAL));
    }

    throw new PostError(
      PostErrorType.API_ERROR,
      `Pinterest video media ${media_id} processing timed out (last status: ${lastStatus}). No Pin was created.`,
    );
  }

  static validate(content: Content, options?: PostOptions["pinterest"]): ValidationResult {
    return validateContentForPlatform("pinterest", content, { pinterest: options });
  }

  private getS3Uploader(): S3MediaUploader {
    if (!this.s3MediaUploader) {
      this.s3MediaUploader = new S3MediaUploader();
    }
    return this.s3MediaUploader;
  }

  private async resolveImageMedia(media: Media): Promise<{ source_type: "image_url"; url: string }> {
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
      source_type: "image_url",
      url,
    };
  }

  private async resolveImageBase64(
    media: Media,
    tempFileManager: TempFileManager,
  ): Promise<{ source_type: "image_base64"; content_type: "image/jpeg" | "image/png"; data: string }> {
    const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
    tempFileManager.add(cleanup);
    const contentType = media.contentType ?? getContentType(resolvedPath);
    if (contentType !== "image/jpeg" && contentType !== "image/png") {
      throw new Error(`Pinterest Base64 fallback does not support ${contentType}.`);
    }
    const bytes = await readFile(resolvedPath);
    return {
      source_type: "image_base64",
      content_type: contentType,
      data: bytes.toString("base64"),
    };
  }

  private pinMatchesCreate(pin: PinterestPin, payload: PinterestCreatePayload, requestedAt: number): boolean {
    const createdAt = Date.parse(pin.created_at ?? "");
    if (!Number.isFinite(createdAt) || createdAt < requestedAt - CREATE_RECONCILIATION_CLOCK_SKEW_MS) return false;
    if (pin.is_owner === false) return false;
    if (pin.board_id && pin.board_id !== payload.board_id) return false;
    return (
      optionalText(pin.title) === optionalText(payload.title) &&
      optionalText(pin.description) === optionalText(payload.description) &&
      optionalText(pin.link) === optionalText(payload.link) &&
      (pin.alt_text === undefined || optionalText(pin.alt_text) === optionalText(payload.alt_text))
    );
  }

  /**
   * Pinterest does not offer idempotency keys for Pin creation. A readback is
   * therefore required before retrying an ambiguous provider-side failure.
   * Throwing on a failed readback is intentional: absence was not confirmed.
   */
  private async findCreatedPin(
    payload: PinterestCreatePayload,
    requestedAt: number,
  ): Promise<PinterestPin | undefined> {
    for (const delayMs of CREATE_RECONCILIATION_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const response = await this.client.get<PinterestPinListResponse>(
        `/boards/${encodeURIComponent(payload.board_id)}/pins`,
        { params: { page_size: 250 } },
      );
      const match = response.data.items?.find((pin) => this.pinMatchesCreate(pin, payload, requestedAt));
      if (match?.id) return match;
    }
    return undefined;
  }

  private pinResult(id: string | undefined): PostResult {
    return {
      id,
      ...(id ? { url: `https://www.pinterest.com/pin/${id}/` } : {}),
      error: PostErrorType.NO_ERROR,
    };
  }

  private async createImagePinWithRecovery(
    payload: PinterestCreatePayload,
    media: Media,
    tempFileManager: TempFileManager,
  ): Promise<PostResult> {
    const requestedAt = Date.now();
    try {
      const response = await this.client.post("/pins", payload);
      return this.pinResult(response.data?.id);
    } catch (error: unknown) {
      const firstError = error as PinterestApiError;
      if (!isTransientCreateError(firstError)) throw error;

      this.logger.warn(
        `Pinterest create Pin returned transient error ${TRANSIENT_CREATE_ERROR_CODE}; checking for an accepted Pin before retrying.`,
      );
      let accepted: PinterestPin | undefined;
      try {
        accepted = await this.findCreatedPin(payload, requestedAt);
      } catch (readbackError) {
        throw new PostError(
          PostErrorType.API_ERROR,
          `Failed to post to Pinterest: ${firstError.response?.data?.message ?? firstError.message ?? "Unknown error"} Pinterest readback could not verify whether the Pin was created.`,
          {
            ...pinterestErrorDetails(firstError),
            reconciliationError: readbackError instanceof Error ? readbackError.message : String(readbackError),
          },
        );
      }
      if (accepted?.id) {
        this.logger.info(`Pinterest readback recovered Pin ${accepted.id}.`);
        return this.pinResult(accepted.id);
      }

      let fallbackSource: PinterestCreatePayload["media_source"];
      try {
        fallbackSource = await this.resolveImageBase64(media, tempFileManager);
      } catch (fallbackError) {
        this.logger.error(fallbackError instanceof Error ? fallbackError : String(fallbackError));
        throw firstError;
      }

      this.logger.warn("Pinterest readback confirmed no Pin; retrying once with direct image data.");
      const retryRequestedAt = Date.now();
      const retryPayload = { ...payload, media_source: fallbackSource };
      try {
        const response = await this.client.post("/pins", retryPayload);
        return this.pinResult(response.data?.id);
      } catch (retryError: unknown) {
        const typedRetryError = retryError as PinterestApiError;
        if (!isTransientCreateError(typedRetryError)) throw retryError;
        let acceptedRetry: PinterestPin | undefined;
        try {
          acceptedRetry = await this.findCreatedPin(retryPayload, retryRequestedAt);
        } catch (readbackError) {
          throw new PostError(
            PostErrorType.API_ERROR,
            `Failed to post to Pinterest: ${typedRetryError.response?.data?.message ?? typedRetryError.message ?? "Unknown error"} Pinterest readback could not verify whether the retried Pin was created.`,
            {
              ...pinterestErrorDetails(typedRetryError),
              reconciliationError: readbackError instanceof Error ? readbackError.message : String(readbackError),
            },
          );
        }
        if (acceptedRetry?.id) {
          this.logger.info(`Pinterest readback recovered retried Pin ${acceptedRetry.id}.`);
          return this.pinResult(acceptedRetry.id);
        }
        throw retryError;
      }
    }
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = validatePinterestContent(content, options?.pinterest);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Pinterest content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }
    this.validateOptions(options);

    const media = content.media?.[0];
    const tempFileManager = new TempFileManager();

    try {
      let mediaSource: Record<string, unknown>;

      if (media?.type === "video") {
        const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
        tempFileManager.add(cleanup);

        const mediaId = await this.createVideoMedia(resolvedPath);
        mediaSource = {
          source_type: "video_id",
          // Pinterest accepts either a supplied cover or a frame from the video.
          ...(media.thumbnailUrl ? { cover_image_url: media.thumbnailUrl } : { cover_image_key_frame_time: 0 }),
          media_id: mediaId,
        };
      } else if (media) {
        mediaSource = await this.resolveImageMedia(media);
      } else {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Pinterest posts require an image or video.");
      }

      const title = options.pinterest.title ?? (media?.type === "video" ? media.title : undefined);
      if (title && title.length > PINTEREST_MAX_TITLE_LENGTH) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          `Pinterest titles cannot exceed ${PINTEREST_MAX_TITLE_LENGTH} characters.`,
        );
      }

      const payload: PinterestCreatePayload = {
        board_id: options.pinterest.boardId,
        media_source: mediaSource,
        title,
        description: options.pinterest.description ?? content.text ?? undefined,
        link: options.pinterest.link,
        alt_text: options.pinterest.altText ?? (media?.type === "image" ? media.caption : undefined),
      };

      if (media.type === "image") return await this.createImagePinWithRecovery(payload, media, tempFileManager);

      const response = await this.client.post("/pins", payload);
      return this.pinResult(response.data?.id);
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as PinterestApiError;
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Pinterest: ${err.response?.data?.message || err.message || "Unknown error"}`,
        pinterestErrorDetails(err),
      );
    } finally {
      await tempFileManager.cleanup();
      await this.cleanupS3Files();
    }
  }
}
