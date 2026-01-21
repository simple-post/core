import fs from "node:fs";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { AxiosInstance } from "axios";

const FACEBOOK_API_VERSION = "v23.0";
const MAX_MEDIA_COUNT = 10;
const MAX_CAPTION_LENGTH = 2200;
const PROCESSING_POLL_INTERVAL = 3000;

export class InstagramPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  private client: AxiosInstance;
  private businessAccountId: string;

  private s3MediaUploader: S3MediaUploader;
  private s3TempFileKeys: string[] = [];

  constructor(options?: PostOptionsWithCredentials) {
    super("Instagram", options);

    // Validate the credentials
    if (!options?.instagram?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram credentials are required in options.instagram.credentials",
      );
    }
    const { accessToken, businessAccountId } = options.instagram.credentials;
    this.businessAccountId = businessAccountId;

    // Create axios client with base configuration
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${FACEBOOK_API_VERSION}`,
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
      const response = await this.client.post(`/${this.businessAccountId}/media`, {
        media_type: mediaType,
        caption: isCarousel ? undefined : caption,
        is_carousel_item: isCarousel,
        ...(media.type === "video" ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      });

      return response.data.id;
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(PostErrorType.API_ERROR, `Failed to create media object: ${error.message}`, error);
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

      throw new PostError(PostErrorType.API_ERROR, `Failed to create media container: ${error.message}`, error);
    }
  }

  private validate(content: Content): void {
    if (!content.media || content.media.length === 0)
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Instagram posts require at least one media item (image or video).",
      );

    // Validate the number of media files
    this.strictCheck(
      content.media.length > MAX_MEDIA_COUNT,
      `Instagram posts support maximum ${MAX_MEDIA_COUNT} media items.`,
    );

    // Validate each media has a valid source (path or url)
    for (const media of content.media) {
      if (!hasValidSource(media)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Media must have either a path or url");
      }
      // If path is provided, check it exists
      if (media.path && !fs.existsSync(media.path)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
      }
    }

    // Caption length validation (Instagram limit is 2200 characters)
    this.strictCheck(
      Boolean(content.text && content.text.length > MAX_CAPTION_LENGTH),
      `Instagram caption cannot exceed ${MAX_CAPTION_LENGTH} characters.`,
    );
  }

  async postContent(content: Content, _options: PostOptionsWithCredentials): Promise<PostResult> {
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
      if (error instanceof PostError) throw error;

      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish post: ${error.response?.data?.error?.message || error.message}`,
        error,
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
