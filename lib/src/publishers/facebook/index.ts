import { Content, Media } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import axios, { AxiosInstance } from "axios";

export class FacebookPublisher extends Publisher {
  private client: AxiosInstance;
  private pageAccessToken: string;
  private pageId: string;

  constructor() {
    super();

    this.pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
    this.pageId = process.env.FACEBOOK_PAGE_ID!;

    if (!this.pageAccessToken) {
      throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required");
    }

    if (!this.pageId) {
      throw new Error("FACEBOOK_PAGE_ID environment variable is required");
    }

    this.client = axios.create({
      baseURL: 'https://graph.facebook.com/v23.0',
      timeout: 30000,
    });
  }

  async uploadMedia(media: Media): Promise<string> {
    if (!media.path) {
      throw new Error("Media path is required");
    }

    try {
      const formData = new FormData();
      
      if (media.type === "image") {
        // For images, upload to the page's photos
        const fs = await import('fs');
        const fileBuffer = fs.readFileSync(media.path);
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
        const fs = await import('fs');
        const fileBuffer = fs.readFileSync(media.path);
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

      throw new Error(`Unsupported media type: ${(media as any).type}`);
    } catch (error: any) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error uploading media: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data
      );
    }
  }

  async postToPage(content: Content): Promise<string> {
    // Check for empty post
    if (!content.text && !content.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook");
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
          const mediaId = await this.uploadMedia(media);
          
          if (media.type === "image") {
            // For single image, use the photo endpoint with the uploaded photo ID
            postData.object_attachment = mediaId;
          } else if (media.type === "video") {
            // For single video, use the video endpoint with the uploaded video ID
            postData.object_attachment = mediaId;
          }
        } else {
          // Multiple media post (only images supported for multi-media posts)
          const imageMedias = content.media.filter(m => m.type === "image");
          if (imageMedias.length !== content.media.length) {
            throw new PostError(
              PostErrorType.INVALID_CONTENT,
              "Multi-media posts only support images"
            );
          }

          if (imageMedias.length > 10) {
            throw new PostError(
              PostErrorType.INVALID_CONTENT,
              "Facebook supports maximum of 10 images in a single post"
            );
          }

                     // Upload all images and create attached_media array
           const attachedMedia = [];
           for (const media of imageMedias as Media[]) {
             const mediaId = await this.uploadMedia(media);
             attachedMedia.push({ media_fbid: mediaId });
           }
          
          postData.attached_media = JSON.stringify(attachedMedia);
        }
      }

      // Post to Facebook page feed
      const response = await this.client.post(`/${this.pageId}/feed`, postData);
      
      return response.data.id;
    } catch (error: any) {
      if (error instanceof PostError) {
        throw error;
      }
      
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error posting to Facebook: ${error.response?.data?.error?.message || error.message}`,
        error.response?.data
      );
    }
  }

  async post(content: Content[]): Promise<PostResult[]> {
    const results: PostResult[] = [];

    // Facebook doesn't support threading like Twitter, so we post each content item separately
    for (const item of content) {
      try {
        const postId = await this.postToPage(item);

        results.push({
          id: postId,
          error: PostErrorType.NO_ERROR,
        });
      } catch (error: any) {
        if (error instanceof PostError) {
          results.push({
            error: error.errorType,
            message: error.message,
            details: error.details,
          });
        } else {
          results.push({
            error: PostErrorType.OTHER,
            message: `Error posting: ${error.message}`,
            details: error,
          });
        }
      }
    }

    return results;
  }
}