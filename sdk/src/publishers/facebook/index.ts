import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import { FACEBOOK_MAX_MEDIA_COUNT, FACEBOOK_VALIDATION_RULES, validateFacebookContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Image, PostOptionsWithCredentials, Video } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const FACEBOOK_API_VERSION = "v25.0";

export class FacebookPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return FACEBOOK_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private pageAccessToken: string;
  private pageId: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("Facebook", options);

    // Validate the credentials
    if (!options?.facebook?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Facebook credentials are required in options.facebook.credentials",
      );
    }

    this.pageAccessToken = options.facebook.credentials.pageAccessToken;
    this.pageId = options.facebook.credentials.pageId;

    // Create the Facebook API client
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${FACEBOOK_API_VERSION}`,
      timeout: 30_000,
    });
  }

  private async uploadImage(image: Image, resolvedPath: string): Promise<string> {
    try {
      const formData = new FormData();

      // Add the media file
      const fileBuffer = fs.readFileSync(resolvedPath);
      formData.append("source", fileBuffer, {
        filename: path.basename(resolvedPath),
        contentType: getContentType(resolvedPath),
      });

      // Add common parameters
      formData.append("access_token", this.pageAccessToken);
      formData.append("published", "false");

      if (image.caption) formData.append("caption", image.caption);

      const response = await this.client.post(`/${this.pageId}/photos`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      return response.data.id;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to upload image: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  static validate(content: Content): ValidationResult {
    return validateFacebookContent(content);
  }

  private async postVideo(
    video: Video,
    resolvedPath: string,
    options?: PostOptionsWithCredentials,
  ): Promise<PostResult> {
    try {
      const formData = new FormData();

      formData.append("access_token", this.pageAccessToken);

      const fileBuffer = fs.readFileSync(resolvedPath);
      formData.append("source", fileBuffer, {
        filename: path.basename(resolvedPath),
        contentType: getContentType(resolvedPath),
      });

      if (video.title) formData.append("title", video.title);
      if (video.description) formData.append("description", video.description);

      // Add scheduling if specified
      if (options?.facebook?.publishAt) {
        const unixTimestamp = Math.floor(new Date(options.facebook.publishAt).getTime() / 1000);
        formData.append("scheduled_publish_time", unixTimestamp.toString());
        formData.append("published", "false");
      }

      // Post the video
      const response = await this.client.post(`/${this.pageId}/videos`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      return {
        id: response.data.id,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));

      let errorMessage = "An unknown error occurred while posting video.";

      if (err.response?.data?.error?.message) {
        errorMessage = err.response.data.error.message;
      } else if (err.message) {
        errorMessage = err.message;
      }

      throw new PostError(PostErrorType.API_ERROR, errorMessage, err);
    }
  }

  async postContent(content: Content, options: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content
    const validation = FacebookPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Facebook content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const tempFileManager = new TempFileManager();

    try {
      // If the post is a video, publish it directly to the page videos endpoint
      if (content.media && content.media.length === 1 && content.media[0].type === "video") {
        const video = content.media[0];
        const { path: resolvedPath, cleanup } = await resolveMediaPath(video);
        tempFileManager.add(cleanup);

        return await this.postVideo(video, resolvedPath, options);
      }

      const postData: Record<string, unknown> = {
        access_token: this.pageAccessToken,
      };

      // Add text message
      if (content.text) postData.message = content.text;

      // Add scheduling if specified
      if (options?.facebook?.publishAt) {
        const unixTimestamp = Math.floor(new Date(options.facebook.publishAt).getTime() / 1000);
        postData.scheduled_publish_time = unixTimestamp.toString();
        postData.published = false;
      }

      // Add the media
      if (content.media && content.media.length > 0) {
        const attachedMedia = [];
        for (const media of content.media.slice(0, FACEBOOK_MAX_MEDIA_COUNT)) {
          // Resolve media path (download if URL)
          const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
          tempFileManager.add(cleanup);

          // If we are here we know that the media is an Image. If the user is posting video, only 1 media is allowed and this case is handled above.
          const mediaId = await this.uploadImage(media as Image, resolvedPath);

          this.logger.info(`Media uploaded: ${mediaId}`);

          attachedMedia.push({ media_fbid: mediaId });
        }

        postData.attached_media = JSON.stringify(attachedMedia);
      }

      // Post to Facebook page feed (for non-video posts)
      const response = await this.client.post(`/${this.pageId}/feed`, postData);

      return {
        id: response.data.id,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post content: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
