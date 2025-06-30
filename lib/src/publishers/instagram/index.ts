import { Content, Media } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import fs from "fs";
import axios, { AxiosInstance } from "axios";

export class InstagramPublisher extends Publisher {
  private accessToken: string;
  private businessAccountId: string;
  private apiVersion: string = "v23.0";
  private client: AxiosInstance;

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

    this.accessToken = accessToken;
    this.businessAccountId = businessAccountId;

    // Create axios client with base configuration
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${this.apiVersion}`,
      timeout: 30000, // 30 seconds timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  private validate(content: Content[]): void {
    if (content.length !== 1) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram publisher only supports single posts.");
    }

    const postContent = content[0];

    if (!postContent.media || postContent.media.length === 0) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Instagram posts require at least one media item (image or video)."
      );
    }

    if (postContent.media.length > 10) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram posts support maximum 10 media items.");
    }

    // Validate media files
    for (const media of postContent.media) {
      if (!media.path) {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Media file path is required for Instagram posts.");
      }

      if (!fs.existsSync(media.path)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
      }
    }

    // Caption length validation (Instagram limit is 2200 characters)
    if (postContent.text && postContent.text.length > 2200) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Instagram caption cannot exceed 2200 characters.");
    }
  }

  private async createMediaObject(media: Media): Promise<string> {
    if (!media.path) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required");
    }

    const mediaType = media.type === "video" ? "VIDEO" : "IMAGE";

    try {
      // Read file as buffer
      const fileBuffer = fs.readFileSync(media.path);

      // Create FormData using Node.js built-in FormData
      const formData = new FormData();
      formData.append("access_token", this.accessToken);
      formData.append("media_type", mediaType);

      // Create a Blob from the file buffer
      const fieldName = media.type === "video" ? "video" : "image";
      const blob = new Blob([fileBuffer]);
      formData.append(fieldName, blob, media.path.split("/").pop() || "media");

      const response = await this.client.post(`/${this.businessAccountId}/media`, formData);

      return response.data.id;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error creating media object: ${errorMessage}`,
        error.response?.data || error
      );
    }
  }

  private async createMediaContainer(content: Content): Promise<string> {
    try {
      let params: any;

      if (content.media!.length === 1) {
        // Single media post - create media object first
        const mediaObjectId = await this.createMediaObject(content.media![0]);

        params = {
          access_token: this.accessToken,
          media_type: content.media![0].type === "video" ? "VIDEO" : "IMAGE",
          media_id: mediaObjectId,
        };

        if (content.text) {
          params.caption = content.text;
        }
      } else {
        // Carousel post - create all media objects first
        const mediaObjectIds: string[] = [];
        for (const media of content.media!) {
          const mediaObjectId = await this.createMediaObject(media);
          mediaObjectIds.push(mediaObjectId);
        }

        params = {
          access_token: this.accessToken,
          media_type: "CAROUSEL",
          children: mediaObjectIds.join(","),
        };

        if (content.text) {
          params.caption = content.text;
        }
      }

      const response = await this.client.post(`/${this.businessAccountId}/media`, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return response.data.id;
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
      const params = {
        access_token: this.accessToken,
        creation_id: containerId,
      };

      const response = await this.client.post(`/${this.businessAccountId}/media_publish`, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

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

  async post(content: Content[]): Promise<PostResult[]> {
    try {
      this.validate(content);
    } catch (error) {
      if (error instanceof PostError) {
        return [{ error: error.errorType, message: error.message, details: error.details }];
      }
      return [{ error: PostErrorType.OTHER, message: "An unknown error occurred while validating Instagram post." }];
    }

    const postContent = content[0];

    try {
      // Step 1: Create media container (which creates media objects internally)
      const containerId = await this.createMediaContainer(postContent);

      // Step 2: Publish the media container
      const postId = await this.publishMediaContainer(containerId);

      return [
        {
          id: postId,
          error: PostErrorType.NO_ERROR,
        },
      ];
    } catch (error: any) {
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
