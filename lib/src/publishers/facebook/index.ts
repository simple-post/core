import { Content, Media, PostOptions } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import axios, { AxiosInstance } from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";

export class FacebookPublisher extends Publisher {
  private client: AxiosInstance;
  private pageAccessToken: string;
  private pageId: string;

  constructor() {
    super();

    this.pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
    this.pageId = process.env.FACEBOOK_PAGE_ID!;

    if (!this.pageAccessToken) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required"
      );
    }

    if (!this.pageId) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ID environment variable is required");
    }

    this.client = axios.create({
      baseURL: "https://graph.facebook.com/v23.0",
      timeout: 30000,
    });
  }

  async uploadMedia(media: Media): Promise<string> {
    try {
      const formData = new FormData();

      if (media.type === "image") {
        // For images, upload to the page's photos
        const fileBuffer = fs.readFileSync(media.path!);
        formData.append("source", fileBuffer, {
          filename: path.basename(media.path!),
        });

        formData.append("published", "false");
        formData.append("access_token", this.pageAccessToken);

        const response = await this.client.post(`/${this.pageId}/photos`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        return response.data.id;
      } else if (media.type === "video") {
        // For videos, upload to the page's videos
        const fileBuffer = fs.readFileSync(media.path!);
        formData.append("source", fileBuffer, {
          filename: path.basename(media.path!),
          contentType: "video/mp4",
        });
        formData.append("published", "false");
        if (media.title) {
          formData.append("title", media.title);
        }
        if (media.description) {
          formData.append("description", media.description);
        }
        formData.append("access_token", this.pageAccessToken);

        const response = await this.client.post(`/${this.pageId}/videos`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
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

  validate(content: Content): void {
    // Check for empty post
    if (!content.text && !content.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook");
    }

    // Validate media if present
    if (content.media && content.media.length > 0) {
      // Check for videos - they can only be single media posts
      const videoMedias = content.media.filter((m) => m.type === "video");
      if (videoMedias.length > 0) {
        if (content.media.length > 1) {
          throw new PostError(
            PostErrorType.INVALID_CONTENT,
            "Video posts can only contain a single video, no other media"
          );
        }
      }

      // Check for too many images in multi-media posts
      if (content.media.length > 10) {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Facebook supports maximum of 10 images in a single post");
      }

      // For multiple media, only images are supported
      if (content.media.length > 1) {
        const imageMedias = content.media.filter((m) => m.type === "image");
        if (imageMedias.length !== content.media.length) {
          throw new PostError(PostErrorType.INVALID_CONTENT, "Multi-media posts only support images");
        }
      }

      // Validate each media item has a path
      for (const media of content.media) {
        if (!media.path) {
          throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required");
        }
      }
    }
  }

  async post(content: Content, options: PostOptions): Promise<PostResult[]> {
    // Validate the content
    try {
      this.validate(content);
    } catch (error) {
      if (error instanceof PostError) {
        return [{ error: error.errorType, message: error.message, details: error.details }];
      }
      return [{ error: PostErrorType.OTHER, message: "An unknown error occurred while validating Facebook post." }];
    }

    try {
      const postData: any = {
        access_token: this.pageAccessToken,
      };

      // Add text message
      if (content.text) {
        postData.message = content.text;
      }

      // Handle media
      if (content.media && content.media.length > 0) {
        if (content.media.length === 1) {
          // Single media post
          const media = content.media[0];

          if (media.type === "image") {
            // For single image, upload unpublished and attach
            const mediaId = await this.uploadMedia(media);
            postData.object_attachment = mediaId;
          } else if (media.type === "video") {
            // For single video, publish directly - create form data for direct video post
            const formData = new FormData();
            const fileBuffer = fs.readFileSync(media.path!);

            formData.append("source", fileBuffer, {
              filename: path.basename(media.path!),
              contentType: "video/mp4",
            });

            if (content.text) {
              formData.append("description", content.text);
            }
            if (media.title) {
              formData.append("title", media.title);
            }
            if (media.description) {
              formData.append("description", media.description);
            }
            formData.append("access_token", this.pageAccessToken);

            // Post video directly to page videos endpoint
            const response = await this.client.post(`/${this.pageId}/videos`, formData, {
              headers: {
                "Content-Type": "multipart/form-data",
              },
            });

            return [
              {
                id: response.data.id,
                error: PostErrorType.NO_ERROR,
              },
            ];
          }
        } else {
          // Multiple media post (validation ensures all are images)
          const attachedMedia = [];
          for (const media of content.media as Media[]) {
            const mediaId = await this.uploadMedia(media);
            attachedMedia.push({ media_fbid: mediaId });
          }

          postData.attached_media = JSON.stringify(attachedMedia);
        }
      }

      // Post to Facebook page feed (for non-video posts)
      const response = await this.client.post(`/${this.pageId}/feed`, postData);

      return [
        {
          id: response.data.id,
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
      }

      return [
        {
          error: PostErrorType.API_ERROR,
          message: `Error posting to Facebook: ${error.response?.data?.error?.message || error.message}`,
          details: error.response?.data,
        },
      ];
    }
  }
}
