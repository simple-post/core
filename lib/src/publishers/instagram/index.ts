import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import { v7 as uuidv7 } from "uuid";

import { PostError, PostErrorType } from "../../types";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptions } from "../../types/post";
import type { AxiosInstance } from "axios";

export class InstagramPublisher extends Publisher {
  private client: AxiosInstance;
  private businessAccountId: string;

  private s3MediaUploader: S3MediaUploader;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptions) {
    super("Instagram", options);

    // Validate the credentials
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !businessAccountId) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID environment variables are required",
      );
    }

    this.businessAccountId = businessAccountId;

    // Create axios client with base configuration
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/v23.0`,
      timeout: 30_000, // 30 seconds timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // Create S3 media uploader
    this.s3MediaUploader = new S3MediaUploader();
  }

  private async cleanupS3Files(): Promise<void> {
    await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader.deleteFile(key)));
  }

  private async waitForMediaReady(containerId: string): Promise<void> {
    while (true) {
      const statusRes = await this.client.get(`/${containerId}?fields=status_code,status`);
      const statusCode = statusRes.data.status_code;
      const status = statusRes.data.status;

      if (statusCode === "FINISHED") return;

      if (statusCode === "ERROR")
        throw new PostError(
          PostErrorType.API_ERROR,
          `Instagram media container ${containerId} creation failed: ${status}`,
        );

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  private async createMediaObject(media: Media, isCarousel: boolean, caption?: string): Promise<string> {
    // Get the Instagram media type
    const mediaType = media.type === "video" ? "REELS" : undefined;

    // Upload file temporarily to S3
    const key = `${uuidv7()}_${path.basename(media.path)}`;
    const mediaUrl = await this.s3MediaUploader.uploadFile(media.path, key);
    this.s3TempFileKeys.push(key);
    this.logger.info(`Uploaded media file to S3: ${mediaUrl}`);

    try {
      // Create media object using the S3 URL
      const response = await this.client.post(`/${this.businessAccountId}/media`, {
        media_type: mediaType,
        caption: isCarousel ? undefined : caption,
        is_carousel_item: isCarousel,
        ...(media.type === "video" ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      });

      return response.data.id;
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(PostErrorType.API_ERROR, `Error creating media object: ${error.message}`, error);
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
        const response = await this.client.post(`/${this.businessAccountId}/media`, {
          media_type: "CAROUSEL",
          caption: content.text,
          children: mediaObjectIds.join(","),
        });

        containerId = response.data.id;
      }

      return containerId;
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(PostErrorType.API_ERROR, `Error creating Instagram media container: ${error.message}`, error);
    }
  }

  private validate(content: Content): void {
    if (!content.media || content.media.length === 0)
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Instagram posts require at least one media item (image or video).",
      );

    // Validate the number of media files
    this.strictCheck(content.media.length > 10, "Instagram posts support maximum 10 media items.");

    // Validate each media file
    for (const media of content.media) {
      if (!fs.existsSync(media.path)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
      }
    }

    // Caption length validation (Instagram limit is 2200 characters)
    this.strictCheck(
      Boolean(content.text && content.text.length > 2200),
      "Instagram caption cannot exceed 2200 characters.",
    );
  }

  async postContent(content: Content, _options: PostOptions): Promise<PostResult> {
    // Validate the content
    this.validate(content);

    try {
      // Create media container
      const containerId = await this.createMediaContainer(content);

      // Wait for the container to be ready
      await this.waitForMediaReady(containerId);

      // Publish the container
      const response = await this.client.post(`/${this.businessAccountId}/media_publish`, { creation_id: containerId });

      return { id: response.data.id, error: PostErrorType.NO_ERROR };
    } catch (error: any) {
      if (error instanceof PostError) return { error: error.errorType, message: error.message, details: error.details };

      this.logger.error(error);

      return {
        error: PostErrorType.API_ERROR,
        message: `Error publishing Instagram post: ${error.response?.data?.error?.message || error.message}`,
        details: error,
      };
    } finally {
      await this.cleanupS3Files();
    }
  }
}
