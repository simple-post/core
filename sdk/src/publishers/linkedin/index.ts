import fs from "node:fs";

import axios from "axios";

import {
  LINKEDIN_MAX_IMAGES,
  LINKEDIN_MAX_VIDEOS,
  LINKEDIN_VALIDATION_RULES,
  validateLinkedInContent,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult, RepostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials, QuoteTarget, RepostTarget } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

interface LinkedInUploadInfo {
  uploadUrl: string;
  headers?: Record<string, string>;
}

const LINKEDIN_REST_VERSION = "202606";

export class LinkedInPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return LINKEDIN_VALIDATION_RULES;
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
    return validateLinkedInContent(content);
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
      const images = media.filter((item) => item.type === "image").slice(0, LINKEDIN_MAX_IMAGES);
      const videos = media.filter((item) => item.type === "video").slice(0, LINKEDIN_MAX_VIDEOS);

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

  private async publishReshare(
    targetPostId: string,
    commentary: string,
    options: PostOptionsWithCredentials | undefined,
    action: "quote" | "repost",
  ): Promise<PostResult> {
    const visibility = options?.linkedin?.visibility ?? "PUBLIC";

    try {
      const response = await axios.post(
        "https://api.linkedin.com/rest/posts",
        {
          author: `urn:li:person:${this.memberId}`,
          commentary,
          visibility,
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          reshareContext: {
            parent: targetPostId,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "X-Restli-Protocol-Version": "2.0.0",
            "Linkedin-Version": LINKEDIN_REST_VERSION,
            "Content-Type": "application/json",
          },
        },
      );

      return {
        id: response.data?.id || response.headers?.["x-restli-id"],
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to ${action} on LinkedIn: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  async quoteContent(content: Content, target: QuoteTarget, options?: PostOptionsWithCredentials): Promise<PostResult> {
    if (content.media?.length) {
      this.logger.warn("LinkedIn quote posts cannot include new media; posting the commentary-only reshare.");
    }

    return this.publishReshare(target.postId, content.text ?? "", options, "quote");
  }

  async repostContent(target: RepostTarget, options?: PostOptionsWithCredentials): Promise<RepostResult> {
    return this.publishReshare(target.postId, "", options, "repost");
  }
}
