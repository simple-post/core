import fs from "node:fs";

import axios from "axios";

import { LINKEDIN_MAX_IMAGES, LINKEDIN_MAX_VIDEOS, LINKEDIN_VALIDATION_RULES } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";
import { httpStatus, withTransientRetry } from "../../utils/transient-retry";
import { validateContentForPlatform } from "../../validation";
import { Publisher } from "../base";

import type { PostResult, RepostResult } from "../../types";
import type {
  PostOptions,
  Content,
  Media,
  PostOptionsWithCredentials,
  QuoteTarget,
  RepostTarget,
} from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

interface LinkedInUploadInfo {
  uploadUrl: string;
  headers?: Record<string, string>;
}

interface LinkedInAssetStatus {
  status?: string;
  recipes?: { recipe?: string; status?: string }[];
}

const LINKEDIN_REST_VERSION = "202606";
const LINKEDIN_VIDEO_RECIPE = "urn:li:digitalmediaRecipe:feedshare-video";
const ASSET_PROCESSING_TIMEOUT_MS = 180_000;
const ASSET_POLL_INTERVAL_MS = 3000;
const UPLOAD_TIMEOUT_MS = 600_000;

/** Allowlisted diagnostics only: provider errors carry the bearer token and signed upload URL. */
function stageDetails(stage: string, error: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const status = httpStatus(error);
  const body = (error as { response?: { data?: { serviceErrorCode?: unknown } } } | undefined)?.response?.data;
  const code = body?.serviceErrorCode;
  return { stage, ...(status && { httpStatus: status }), ...(typeof code === "number" && { code }), ...extra };
}

export class LinkedInPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return LINKEDIN_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private accessToken: string;
  private memberId: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("LinkedIn", options, "linkedin");

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
      // Registration only reserves an asset; nothing is published before ugcPosts.
      const response = await withTransientRetry(() =>
        this.client.post("/assets?action=registerUpload", {
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
        }),
      );

      const uploadMechanism =
        response.data?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];

      if (!uploadMechanism?.uploadUrl || !response.data?.value?.asset) {
        throw new PostError(PostErrorType.PREPARATION_ERROR, "LinkedIn did not return upload information.", {
          stage: "register",
        });
      }

      return {
        asset: response.data.value.asset,
        uploadInfo: {
          uploadUrl: uploadMechanism.uploadUrl,
          headers: uploadMechanism.headers,
        },
      };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const status = httpStatus(error);
      this.logger.error(`Failed to register LinkedIn upload${status ? ` (HTTP ${status})` : ""}.`);
      throw new PostError(
        status === 401 ? PostErrorType.CREDENTIALS_ERROR : PostErrorType.PREPARATION_ERROR,
        status === 401
          ? "LinkedIn rejected the credentials while registering the media upload."
          : "LinkedIn did not register the media upload. No post was created; retry the post.",
        stageDetails("register", error),
      );
    }
  }

  private async uploadAsset(resolvedPath: string, uploadInfo: LinkedInUploadInfo): Promise<void> {
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    try {
      // The signed PUT stores bytes only. Each attempt streams the file again
      // and is capped by the remaining budget rather than a fresh full window.
      await withTransientRetry(async (remainingMs) => {
        const fileStream = fs.createReadStream(resolvedPath);
        try {
          await axios.put(uploadInfo.uploadUrl, fileStream, {
            timeout: Math.min(UPLOAD_TIMEOUT_MS, remainingMs),
            headers: {
              ...uploadInfo.headers,
              "Content-Type": getContentType(resolvedPath),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
        } finally {
          fileStream.destroy();
        }
      });
    } catch (error: unknown) {
      const status = httpStatus(error);
      this.logger.error(`Failed to upload LinkedIn media${status ? ` (HTTP ${status})` : ""}.`);
      throw new PostError(
        PostErrorType.PREPARATION_ERROR,
        "LinkedIn did not accept the uploaded media. No post was created; retry the post.",
        stageDetails("upload", error),
      );
    }
  }

  /**
   * LinkedIn's Assets API requires the feedshare-video recipe itself to reach
   * AVAILABLE, with the asset ALLOWED, before it is referenced in a share. Any
   * other recipe is never accepted as a substitute. Read-only status checks
   * reuse the same asset ID within a bounded window; no post exists until
   * ugcPosts succeeds.
   */
  private async waitForVideoAsset(assetUrn: string): Promise<void> {
    const assetId = /^urn:li:digitalmediaAsset:([\w-]+)$/.exec(assetUrn)?.[1];
    if (!assetId) {
      throw new PostError(PostErrorType.PREPARATION_ERROR, "LinkedIn returned an unrecognized asset identifier.", {
        stage: "processing",
      });
    }
    const deadline = Date.now() + ASSET_PROCESSING_TIMEOUT_MS;
    const details = (extra: Record<string, unknown> = {}) => ({ stage: "processing", assetId, ...extra });
    let status: string | undefined;
    let assetStatus: string | undefined;

    while (true) {
      if (Date.now() >= deadline) {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "LinkedIn did not finish processing the video within 3 minutes. No post was created; retry the post.",
          details({ status }),
        );
      }

      try {
        const response = await withTransientRetry(
          (remainingMs) =>
            this.client.get<LinkedInAssetStatus>(`/assets/${encodeURIComponent(assetId)}`, {
              timeout: Math.min(30_000, remainingMs),
            }),
          { deadline },
        );
        assetStatus = response.data?.status;
        status = response.data?.recipes?.find((entry) => entry.recipe === LINKEDIN_VIDEO_RECIPE)?.status;
      } catch (error: unknown) {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "Could not confirm that LinkedIn finished processing the video. No post was created; retry the post.",
          stageDetails("processing", error, { assetId }),
        );
      }

      if (assetStatus === "BLOCKED" || assetStatus === "DELETED" || assetStatus === "ABANDONED") {
        throw new PostError(
          assetStatus === "BLOCKED" ? PostErrorType.INVALID_CONTENT : PostErrorType.PREPARATION_ERROR,
          `LinkedIn will not publish this video asset (${assetStatus}). No post was created.`,
          details({ code: "asset_not_allowed", status, assetStatus }),
        );
      }
      if (status === "AVAILABLE" && (assetStatus === undefined || assetStatus === "ALLOWED")) return;
      if (status === "CLIENT_ERROR") {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          "LinkedIn could not process the uploaded video. Check the file before publishing again.",
          details({ code: "video_processing_failed", status }),
        );
      }
      if (status === "SERVER_ERROR" || status === "INCOMPLETE") {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          `LinkedIn video processing failed (${status}). No post was created; retry the post.`,
          details({ status }),
        );
      }
      // A missing video recipe (for example only an image recipe) is never accepted.
      if (status !== "NEW" && status !== "PROCESSING" && status !== "WAITING_UPLOAD") {
        throw new PostError(
          PostErrorType.PREPARATION_ERROR,
          "LinkedIn returned an unrecognized video processing status. No post was created; retry the post.",
          details({ status, ...(assetStatus && { assetStatus }) }),
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(ASSET_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))),
      );
    }
  }

  static validate(content: Content, options?: PostOptions["linkedin"]): ValidationResult {
    return validateContentForPlatform("linkedin", content, { linkedin: options });
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = LinkedInPublisher.validate(content, options?.linkedin);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "LinkedIn content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const tempFileManager = new TempFileManager();
    let publishSubmitted = false;

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
        await this.waitForVideoAsset(asset);

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

      publishSubmitted = true;
      const response = await this.client.post("/ugcPosts", payload);

      return {
        id: response.data?.id || response.headers?.["x-restli-id"],
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      // Preparation stages already classified their failure; ugcPosts is never retried here.
      if (error instanceof PostError) throw error;
      const status = httpStatus(error);
      this.logger.error(`Failed to post to LinkedIn${status ? ` (HTTP ${status})` : ""}.`);
      throw new PostError(
        publishSubmitted ? PostErrorType.API_ERROR : PostErrorType.PREPARATION_ERROR,
        publishSubmitted
          ? "LinkedIn did not confirm the post. Check LinkedIn before retrying."
          : "LinkedIn post preparation failed before publication. Retry the post.",
        stageDetails(publishSubmitted ? "publish" : "prepare", error),
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
          timeout: 30_000,
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
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "LinkedIn quotes cannot include new attachments. Remove them or publish an ordinary post.",
        { code: "quote_media_unsupported" },
      );
    }

    return this.publishReshare(target.postId, content.text ?? "", options, "quote");
  }

  async repostContent(target: RepostTarget, options?: PostOptionsWithCredentials): Promise<RepostResult> {
    return this.publishReshare(target.postId, "", options, "repost");
  }
}
