import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import { PostError, PostErrorType } from "../../types";
import { getContentType, hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Image, Media, PostOptionsWithCredentials, Video } from "../../types/post";
import type { AxiosInstance } from "axios";

const FACEBOOK_API_VERSION = "v23.0";

const MAX_MEDIA_COUNT = 10;
const MAX_TEXT_LENGTH = 63_206;

export class FacebookPublisher extends Publisher {
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
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to upload image: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data,
      );
    }
  }

  private validate(content: Content): asserts content is (Content & { media: Media[] }) | (Content & { text: string }) {
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
      this.strictCheck(
        content.media.length > MAX_MEDIA_COUNT,
        `Facebook supports maximum of ${MAX_MEDIA_COUNT} images in a single post`,
      );

      // Validate each media item has a valid source (path or url)
      for (const media of content.media) {
        if (!hasValidSource(media)) {
          throw new PostError(PostErrorType.INVALID_CONTENT, "Media must have either a path or url");
        }
        // If path is provided, check it exists
        if (media.path && !fs.existsSync(media.path)) {
          throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
        }
      }
    }

    // Validate text length
    if (content.text && content.text.length > MAX_TEXT_LENGTH) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `Facebook text posts cannot exceed ${MAX_TEXT_LENGTH.toLocaleString()} characters. Current length: ${content.text.length}`,
      );
    }
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
    } catch (error: any) {
      this.logger.error(error);

      let errorMessage = "An unknown error occurred while posting video.";

      if (error.response && error.response.data && error.response.data.error) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      throw new PostError(PostErrorType.API_ERROR, errorMessage, error);
    }
  }

  async postContent(content: Content, options: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content
    this.validate(content);

    const tempFileManager = new TempFileManager();

    try {
      // If the post is a video, publish it directly to the page videos endpoint
      if (content.media && content.media.length === 1 && content.media[0].type === "video") {
        const video = content.media[0];
        const { path: resolvedPath, cleanup } = await resolveMediaPath(video);
        tempFileManager.add(cleanup);

        return await this.postVideo(video, resolvedPath, options);
      }

      const postData: any = {
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
        for (const media of content.media.slice(0, MAX_MEDIA_COUNT)) {
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
    } catch (error: any) {
      this.logger.error(error);

      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post content: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data,
      );
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
