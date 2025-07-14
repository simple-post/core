import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import { PostError, PostErrorType } from "../../types";
import { getContentType } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Image, Media, PostOptions, Video } from "../../types/post";
import type { AxiosInstance } from "axios";

export class FacebookPublisher extends Publisher {
  private client: AxiosInstance;
  private pageAccessToken: string;
  private pageId: string;

  constructor(options?: PostOptions) {
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
      baseURL: "https://graph.facebook.com/v23.0",
      timeout: 30_000,
    });
  }

  async uploadImage(image: Image): Promise<string> {
    try {
      const formData = new FormData();

      // Add the media file
      const fileBuffer = fs.readFileSync(image.path);
      formData.append("source", fileBuffer, {
        filename: path.basename(image.path),
        contentType: getContentType(image.path),
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
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Error uploading image: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data,
      );
    }
  }

  validate(content: Content): asserts content is (Content & { media: Media[] }) | (Content & { text: string }) {
    // Check for empty post
    if (!content.text && !content.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook");
    }

    // Validate media if present
    if (content.media && content.media.length > 0) {
      // Check for videos - they can only be single media posts
      const videos = content.media.filter((m) => m.type === "video");
      if (videos.length > 0 && content.media.length > 1) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          "Video posts can only contain a single video, no other media",
        );
      }

      // Check for too many images in multi-media posts
      this.strictCheck(content.media.length > 10, "Facebook supports maximum of 10 images in a single post");

      // Validate each media item exists
      for (const media of content.media) {
        if (!fs.existsSync(media.path!)) {
          throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
        }
      }
    }
  }

  async postVideo(video: Video): Promise<PostResult> {
    try {
      const formData = new FormData();

      formData.append("access_token", this.pageAccessToken);

      const fileBuffer = fs.readFileSync(video.path);
      formData.append("source", fileBuffer, {
        filename: path.basename(video.path),
        contentType: getContentType(video.path),
      });

      if (video.title) formData.append("title", video.title);
      if (video.description) formData.append("description", video.description);

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
    } catch (error: any) {
      this.logger.error(error);

      let errorMessage = "An unknown error occurred while posting video.";

      if (error.response && error.response.data && error.response.data.error) {
        errorMessage = `Facebook API Error: ${error.response.data.error.message}`;
      } else if (error.message) {
        errorMessage = error.message;
      }

      throw new PostError(PostErrorType.API_ERROR, errorMessage, error);
    }
  }

  async postContent(content: Content, _options: PostOptions): Promise<PostResult> {
    // Validate the content
    this.validate(content);

    // If the post is a video, publish it directly to the page videos endpoint
    if (content.media && content.media.length === 1 && content.media[0].type === "video") {
      return this.postVideo(content.media[0]);
    }

    try {
      const postData: any = {
        access_token: this.pageAccessToken,
      };

      // Add text message
      if (content.text) postData.message = content.text;

      // Add the media
      if (content.media && content.media.length > 0) {
        const attachedMedia = [];
        for (const media of content.media.slice(0, 10)) {
          // If we are here we know that the media is an Image. If the user is posting video, only 1 media is allowed and this case is handled above.
          const mediaId = await this.uploadImage(media as Image);

          this.logger.info(`Uploaded image ${mediaId} to Facebook`);

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
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Error posting to Facebook: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data,
      );
    }
  }
}
