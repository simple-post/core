import fs from "node:fs";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { getContentType, hasValidSource, resolveMediaPath, resolveMediaUrl, TempFileManager } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_MEDIA_COUNT = 1;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxCaptionLength: MAX_DESCRIPTION_LENGTH },
  media: { requiresMedia: true, minCount: 1, maxCount: MAX_MEDIA_COUNT, allowsMixed: false },
};

interface PinterestMediaResponse {
  media_id: string;
  upload_url?: string;
}

export class PinterestPublisher extends Publisher {
  static readonly mediaRequirement = "either" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private accessToken: string;
  private s3MediaUploader: S3MediaUploader | null = null;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptionsWithCredentials) {
    super("Pinterest", options);

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
    if (!options?.pinterest?.boardId) {
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
      await axios.put(upload_url, fs.createReadStream(resolvedPath), {
        headers: {
          "Content-Type": getContentType(resolvedPath),
        },
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

    return media_id;
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    if (mediaCount === 0) {
      errors.push({
        platform: "pinterest",
        severity: "error",
        code: "media_required",
        message: "Pinterest posts require at least one media item.",
        field: "media",
      });
    }

    if (text.length > MAX_DESCRIPTION_LENGTH) {
      errors.push({
        platform: "pinterest",
        severity: "error",
        code: "description_too_long",
        message: `Pinterest descriptions cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
        field: "text",
        limit: MAX_DESCRIPTION_LENGTH,
        actual: text.length,
      });
    }

    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "pinterest",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    if (mediaCount > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "pinterest",
        severity: "warning",
        code: "too_many_media",
        message: "Pinterest supports only one media item per pin. Only the first will be posted.",
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

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = PinterestPublisher.validate(content);
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
          media_id: mediaId,
        };
      } else if (media) {
        mediaSource = await this.resolveImageMedia(media);
      } else {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Pinterest posts require an image or video.");
      }

      const title = options.pinterest.title ?? (media?.type === "video" ? media.title : undefined);
      if (title && title.length > MAX_TITLE_LENGTH) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          `Pinterest titles cannot exceed ${MAX_TITLE_LENGTH} characters.`,
        );
      }

      const payload: Record<string, unknown> = {
        board_id: options.pinterest.boardId,
        media_source: mediaSource,
        title,
        description: options.pinterest.description ?? content.text ?? undefined,
        link: options.pinterest.link,
        alt_text: options.pinterest.altText ?? (media?.type === "image" ? media.caption : undefined),
      };

      const response = await this.client.post("/pins", payload);

      return {
        id: response.data?.id,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Pinterest: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFileManager.cleanup();
      await this.cleanupS3Files();
    }
  }
}
