import { Content, Media } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import axios, { AxiosInstance } from "axios";
import fs from "fs";

export class FacebookPublisher extends Publisher {
  private client: AxiosInstance;
  private pageAccessToken: string;
  private pageId: string;

  constructor() {
    super();

    this.pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
    this.pageId = process.env.FACEBOOK_PAGE_ID!;

    if (!this.pageAccessToken) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required");
    }

    if (!this.pageId) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ID environment variable is required");
    }

    this.client = axios.create({
      baseURL: 'https://graph.facebook.com/v23.0',
      timeout: 30000,
    });
  }

  async uploadMedia(media: Media): Promise<string> {
    try {
      const formData = new FormData();
      
      if (media.type === "image") {
        // For images, upload to the page's photos
        const fileBuffer = fs.readFileSync(media.path!);
        const blob = new Blob([fileBuffer]);
        formData.append('source', blob);
        formData.append('published', 'false'); // Upload but don't publish yet
        formData.append('access_token', this.pageAccessToken);

        const response = await this.client.post(`/${this.pageId}/photos`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        return response.data.id;
      } else if (media.type === "video") {
        // For videos, upload to the page's videos
        const fileBuffer = fs.readFileSync(media.path!);
        const blob = new Blob([fileBuffer]);
        formData.append('source', blob);
        formData.append('published', 'false'); // Upload but don't publish yet
        if (media.title) {
          formData.append('title', media.title);
        }
        if (media.description) {
          formData.append('description', media.description);
        }
        formData.append('access_token', this.pageAccessToken);

        const response = await this.client.post(`/${this.pageId}/videos`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        return response.data.id;
      }

      throw new PostError(PostErrorType.INVALID_CONTENT, `Unsupported media type: ${(media as any).type}`);
    } catch (error: any) {
      if (error instanceof PostError) {
        throw error;
      }
      
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error uploading media: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data
      );
    }
  }

    validate(content: Content[]): void {
    // Facebook doesn't support threading, only single posts
    if (content.length !== 1) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Facebook publisher only supports single posts.");
    }

    const postContent = content[0];

    // Check for empty post
    if (!postContent.text && !postContent.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook");
    }

    // Validate media if present
    if (postContent.media && postContent.media.length > 0) {
      // Check for too many images in multi-media posts
      if (postContent.media.length > 10) {
        throw new PostError(
          PostErrorType.INVALID_CONTENT,
          "Facebook supports maximum of 10 images in a single post"
        );
      }

      // For multiple media, only images are supported
      if (postContent.media.length > 1) {
        const imageMedias = postContent.media.filter(m => m.type === "image");
        if (imageMedias.length !== postContent.media.length) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            "Multi-media posts only support images"
          );
        }
      }

      // Validate each media item has a path
      for (const media of postContent.media) {
        if (!media.path) {
          throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required");
        }
      }
    }
  }

  async post(content: Content[]): Promise<PostResult[]> {
    // Validate the content
    try {
      this.validate(content);
    } catch (error) {
      if (error instanceof PostError) {
        return [{ error: error.errorType, message: error.message, details: error.details }];
      }
      return [{ error: PostErrorType.OTHER, message: "An unknown error occurred while validating Facebook post." }];
    }

    // Since validation passed, we know there's exactly one content item
    const postContent = content[0];

    try {
      const postData: any = {
        access_token: this.pageAccessToken,
      };

      // Add text message
      if (postContent.text) {
        postData.message = postContent.text;
      }

      // Handle media
      if (postContent.media && postContent.media.length > 0) {
        if (postContent.media.length === 1) {
          // Single media post
          const media = postContent.media[0];
          const mediaId = await this.uploadMedia(media);
          
          if (media.type === "image") {
            // For single image, use the photo endpoint with the uploaded photo ID
            postData.object_attachment = mediaId;
          } else if (media.type === "video") {
            // For single video, use the video endpoint with the uploaded video ID
            postData.object_attachment = mediaId;
          }
        } else {
          // Multiple media post (validation ensures all are images)
          const attachedMedia = [];
          for (const media of postContent.media as Media[]) {
            const mediaId = await this.uploadMedia(media);
            attachedMedia.push({ media_fbid: mediaId });
          }
          
          postData.attached_media = JSON.stringify(attachedMedia);
        }
      }

      // Post to Facebook page feed
      const response = await this.client.post(`/${this.pageId}/feed`, postData);
      
      return [{
        id: response.data.id,
        error: PostErrorType.NO_ERROR,
      }];
    } catch (error: any) {
      if (error instanceof PostError) {
        return [{
          error: error.errorType,
          message: error.message,
          details: error.details,
        }];
      }
      
      return [{
        error: PostErrorType.API_ERROR,
        message: `Error posting to Facebook: ${error.response?.data?.error?.message || error.message}`,
        details: error.response?.data,
      }];
    }
  }
}