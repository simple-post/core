import { Content, Media, PostOptions } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import fs from "fs";
import axios, { AxiosInstance } from "axios";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream } from "fs";
import { basename } from "path";
import { v7 as uuidv7 } from "uuid";
import { getContentType } from "../../utils";

export class InstagramPublisher extends Publisher {
  private accessToken: string;
  private businessAccountId: string;
  private apiVersion: string = "v23.0";
  private client: AxiosInstance;
  private s3Client: S3Client;
  private s3Bucket: string;
  private s3Region: string;
  private s3BaseUrl: string;

  constructor() {
    super();

    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!accessToken) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram access token is required. Set INSTAGRAM_ACCESS_TOKEN environment variable."
      );
    }

    if (!businessAccountId) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Instagram business account ID is required. Set INSTAGRAM_BUSINESS_ACCOUNT_ID environment variable."
      );
    }

    // S3 configuration for temporary media storage
    const s3AccessKeyId = process.env.INSTAGRAM_S3_STORAGE_ACCESS_KEY_ID;
    const s3SecretAccessKey = process.env.INSTAGRAM_S3_STORAGE_SECRET_ACCESS_KEY;
    const s3Region = process.env.INSTAGRAM_S3_STORAGE_REGION;
    const s3Bucket = process.env.INSTAGRAM_S3_STORAGE_BUCKET;
    const s3Endpoint = process.env.INSTAGRAM_S3_STORAGE_ENDPOINT;
    const s3BaseUrl = process.env.INSTAGRAM_S3_STORAGE_BASE_URL;

    if (!s3AccessKeyId || !s3SecretAccessKey || !s3Region || !s3Bucket || !s3BaseUrl) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "S3 configuration is required for Instagram uploads. Set INSTAGRAM_S3_STORAGE_ACCESS_KEY_ID, INSTAGRAM_S3_STORAGE_SECRET_ACCESS_KEY, INSTAGRAM_S3_STORAGE_REGION, INSTAGRAM_S3_STORAGE_BUCKET, and INSTAGRAM_S3_STORAGE_BASE_URL environment variables."
      );
    }

    this.accessToken = accessToken;
    this.businessAccountId = businessAccountId;
    this.s3Bucket = s3Bucket;
    this.s3Region = s3Region;
    this.s3BaseUrl = s3BaseUrl;

    // Create axios client with base configuration
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${this.apiVersion}`,
      timeout: 30000, // 30 seconds timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    // Create S3 client
    this.s3Client = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
      ...(s3Endpoint && { endpoint: s3Endpoint }),
    });
  }

  private validate(content: Content): void {
    if (!content.media || content.media.length === 0) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Instagram posts require at least one media item (image or video)."
      );
    }

    if (content.media.length > 10) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram posts support maximum 10 media items.");
    }

    // Validate media files
    for (const media of content.media) {
      if (!media.path) {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Media file path is required for Instagram posts.");
      }

      if (!fs.existsSync(media.path)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
      }
    }

    // Caption length validation (Instagram limit is 2200 characters)
    if (content.text && content.text.length > 2200) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram caption cannot exceed 2200 characters.");
    }
  }

  private async uploadToS3(filePath: string): Promise<{ url: string; key: string }> {
    try {
      const filename = basename(filePath);
      const key = `${uuidv7()}_${filename}`;

      const fileStream = createReadStream(filePath);

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.s3Bucket,
          Key: key,
          Body: fileStream,
          ACL: "public-read",
          ContentType: getContentType(filePath),
        },
      });

      await upload.done();

      // Return the public URL and key for cleanup

      console.log(`Uploaded: ${this.s3BaseUrl}/${key}`);

      return {
        url: `${this.s3BaseUrl}/${key}`,
        key: key,
      };
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Error uploading file to S3: ${error.message}`, error);
    }
  }

  private async cleanupS3File(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error: any) {
      // Log error but don't throw - cleanup failure shouldn't fail the post
      console.warn(`Failed to cleanup S3 file ${key}:`, error.message);
    }
  }

  private async waitForMediaReady(containerId: string, timeoutMs = 120000, pollIntervalMs = 3000) {
    const start = Date.now();
    while (true) {
      const statusRes = await this.client.get(`/${containerId}?fields=status_code,status`);
      const statusCode = statusRes.data.status_code;
      const status = statusRes.data.status;

      if (statusCode === "FINISHED") return;

      if (statusCode === "ERROR") throw new Error(status);

      if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for media to be ready for publishing.");

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  private async createMediaObject(
    media: Media,
    isCarousel: boolean,
    caption?: string
  ): Promise<{ id: string; s3Key: string }> {
    if (!media.path) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required");
    }

    const mediaType = media.type === "video" ? "REELS" : undefined;

    try {
      // Upload file to S3 first
      const { url: mediaUrl, key: s3Key } = await this.uploadToS3(media.path);

      // Create media object using the S3 URL
      const response = await this.client.post(`/${this.businessAccountId}/media`, {
        media_type: mediaType,
        caption,
        is_carousel_item: isCarousel,
        ...(media.type === "video" ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      });

      return { id: response.data.id, s3Key };
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error creating media object: ${errorMessage}`,
        error.response?.data || error
      );
    }
  }

  private async createMediaContainer(content: Content): Promise<{ containerId: string; s3Keys: string[] }> {
    try {
      let params: any;
      const s3Keys: string[] = [];

      // Create containers for each object
      const mediaObjectIds: string[] = [];
      for (const media of content.media!) {
        const { id: mediaObjectId, s3Key } = await this.createMediaObject(
          media,
          content.media!.length > 1,
          content.text
        );
        mediaObjectIds.push(mediaObjectId);
        s3Keys.push(s3Key);
      }

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

      return { containerId, s3Keys };
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error creating Instagram media container: ${errorMessage}`,
        error.response?.data || error
      );
    }
  }

  private async publishMediaContainer(containerId: string): Promise<string> {
    try {
      // Wait for the container to be ready
      await this.waitForMediaReady(containerId);

      // Publish the container
      const response = await this.client.post(`/${this.businessAccountId}/media_publish`, { creation_id: containerId });

      return response.data.id;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error publishing Instagram post: ${errorMessage}`,
        error.response?.data || error
      );
    }
  }

  async post(content: Content, options: PostOptions): Promise<PostResult[]> {
    try {
      this.validate(content);
    } catch (error) {
      if (error instanceof PostError) {
        return [{ error: error.errorType, message: error.message, details: error.details }];
      }
      return [{ error: PostErrorType.OTHER, message: "An unknown error occurred while validating Instagram post." }];
    }

    let s3Keys: string[] = [];

    try {
      // Step 1: Create media container (which creates media objects internally)
      const { containerId, s3Keys: uploadedKeys } = await this.createMediaContainer(content);
      s3Keys = uploadedKeys;

      // Step 2: Publish the media container
      const postId = await this.publishMediaContainer(containerId);

      // Step 3: Cleanup S3 files after successful posting
      // await Promise.all(s3Keys.map((key) => this.cleanupS3File(key)));

      return [
        {
          id: postId,
          error: PostErrorType.NO_ERROR,
        },
      ];
    } catch (error: any) {
      // Cleanup S3 files on error too
      if (s3Keys.length > 0) {
        // await Promise.all(s3Keys.map((key) => this.cleanupS3File(key)));
      }

      if (error instanceof PostError) {
        return [
          {
            error: error.errorType,
            message: error.message,
            details: error.details,
          },
        ];
      } else {
        return [
          {
            error: PostErrorType.OTHER,
            message: `Error posting to Instagram: ${error.message}`,
            details: error,
          },
        ];
      }
    }
  }
}
