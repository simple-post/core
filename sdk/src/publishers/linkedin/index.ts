import fs from "node:fs";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { getContentType, hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const MAX_TEXT_LENGTH = 3000;
const MAX_IMAGES = 9;
const MAX_VIDEOS = 1;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: MAX_TEXT_LENGTH },
  media: { maxCount: MAX_IMAGES, maxImages: MAX_IMAGES, maxVideos: MAX_VIDEOS, allowsMixed: false },
};

interface LinkedInUploadInfo {
  uploadUrl: string;
  headers?: Record<string, string>;
}

export class LinkedInPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private accessToken: string;
  private memberId: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("LinkedIn", options);

    if (!options?.linkedin?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "LinkedIn credentials are required in options.linkedin.credentials",
      );
    }

    const { accessToken, memberId } = options.linkedin.credentials;
    this.accessToken = accessToken;
    this.memberId = memberId;

    this.client = axios.create({
      baseURL: "https://api.linkedin.com/v2",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
    });
  }

  private async registerUpload(media: Media): Promise<{ asset: string; uploadInfo: LinkedInUploadInfo }> {
    const recipe =
      media.type === "video"
        ? "urn:li:digitalmediaRecipe:feedshare-video"
        : "urn:li:digitalmediaRecipe:feedshare-image";

    try {
      const response = await this.client.post("/assets?action=registerUpload", {
        registerUploadRequest: {
          owner: `urn:li:person:${this.memberId}`,
          recipes: [recipe],
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      });

      const uploadMechanism =
        response.data?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];

      if (!uploadMechanism?.uploadUrl || !response.data?.value?.asset) {
        throw new PostError(PostErrorType.API_ERROR, "LinkedIn did not return upload information.");
      }

      return {
        asset: response.data.value.asset,
        uploadInfo: {
          uploadUrl: uploadMechanism.uploadUrl,
          headers: uploadMechanism.headers,
        },
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to register LinkedIn upload: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  private async uploadAsset(resolvedPath: string, uploadInfo: LinkedInUploadInfo): Promise<void> {
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    const fileStream = fs.createReadStream(resolvedPath);

    try {
      await axios.put(uploadInfo.uploadUrl, fileStream, {
        headers: {
          ...uploadInfo.headers,
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
        `Failed to upload LinkedIn media: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
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

    if (!text.trim() && mediaCount === 0) {
      errors.push({
        platform: "linkedin",
        severity: "error",
        code: "content_required",
        message: "LinkedIn posts require text or media.",
        field: "text",
      });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      errors.push({
        platform: "linkedin",
        severity: "error",
        code: "text_too_long",
        message: `LinkedIn text cannot exceed ${MAX_TEXT_LENGTH} characters.`,
        field: "text",
        limit: MAX_TEXT_LENGTH,
        actual: text.length,
      });
    }

    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "linkedin",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    if (videos > 0 && images > 0) {
      errors.push({
        platform: "linkedin",
        severity: "error",
        code: "mixed_media_not_supported",
        message: "LinkedIn posts cannot mix images and videos.",
        field: "media",
      });
    }

    if (videos > MAX_VIDEOS) {
      errors.push({
        platform: "linkedin",
        severity: "error",
        code: "too_many_videos",
        message: "LinkedIn supports only one video per post.",
        field: "media",
        limit: MAX_VIDEOS,
        actual: videos,
      });
    }

    if (images > MAX_IMAGES) {
      warnings.push({
        platform: "linkedin",
        severity: "warning",
        code: "too_many_images",
        message: `LinkedIn supports up to ${MAX_IMAGES} images. Only the first ${MAX_IMAGES} will be posted.`,
        field: "media",
        limit: MAX_IMAGES,
        actual: images,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = LinkedInPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "LinkedIn content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const tempFileManager = new TempFileManager();

    try {
      const media = content.media ?? [];
      const images = media.filter((item) => item.type === "image").slice(0, MAX_IMAGES);
      const videos = media.filter((item) => item.type === "video").slice(0, MAX_VIDEOS);

      let shareMediaCategory: "NONE" | "IMAGE" | "VIDEO" = "NONE";
      const mediaEntries: Array<Record<string, unknown>> = [];

      if (videos.length > 0) {
        shareMediaCategory = "VIDEO";
        const video = videos[0];
        const { path: resolvedPath, cleanup } = await resolveMediaPath(video);
        tempFileManager.add(cleanup);

        const { asset, uploadInfo } = await this.registerUpload(video);
        await this.uploadAsset(resolvedPath, uploadInfo);

        mediaEntries.push({
          status: "READY",
          media: asset,
          title: { text: video.title ?? "Video" },
          description: video.description ? { text: video.description } : undefined,
        });
      } else if (images.length > 0) {
        shareMediaCategory = "IMAGE";
        for (const image of images) {
          const { path: resolvedPath, cleanup } = await resolveMediaPath(image);
          tempFileManager.add(cleanup);

          const { asset, uploadInfo } = await this.registerUpload(image);
          await this.uploadAsset(resolvedPath, uploadInfo);

          mediaEntries.push({
            status: "READY",
            media: asset,
            title: { text: image.caption ?? "Image" },
          });
        }
      }

      const visibility = options?.linkedin?.visibility ?? "PUBLIC";

      const payload: Record<string, unknown> = {
        author: `urn:li:person:${this.memberId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content.text ?? "" },
            shareMediaCategory,
            ...(shareMediaCategory === "NONE" ? {} : { media: mediaEntries }),
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": visibility,
        },
      };

      const response = await this.client.post("/ugcPosts", payload);

      return {
        id: response.data?.id || response.headers?.["x-restli-id"],
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to LinkedIn: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
