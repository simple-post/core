import { Content, Media } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import fs from "fs";

const Facebook = require("facebook-js-sdk");

export class FacebookPublisher extends Publisher {
  private facebook: any;

  constructor() {
    super();

    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_PAGE_ID;

    if (!accessToken) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "FACEBOOK_ACCESS_TOKEN environment variable is required"
      );
    }

    if (!pageId) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "FACEBOOK_PAGE_ID environment variable is required"
      );
    }

    this.facebook = new Facebook({
      accessToken: accessToken,
      graphVersion: "v19.0",
    });
  }

  private async uploadPhoto(media: Media, pageId: string): Promise<string> {
    if (!media.path) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for Facebook photo upload");
    }

    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
    }

    try {
      // For photos, we need to upload to the page's photos endpoint
      // The facebook-js-sdk handles file uploads when we provide the file buffer
      const fileBuffer = fs.readFileSync(media.path);
      
      const response = await this.facebook.post(`/${pageId}/photos`, {
        source: fileBuffer,
        published: false, // Upload but don't publish yet, we'll publish with the post
      });

      return response.data.id;
    } catch (error: any) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error uploading photo to Facebook: ${error.message}`,
        error
      );
    }
  }

  private async postToPage(content: Content): Promise<string> {
    const pageId = process.env.FACEBOOK_PAGE_ID!;
    
    // Check for empty content
    if (!content.text && (!content.media || content.media.length === 0)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook");
    }

    try {
      // Handle different post types
      if (content.media && content.media.length > 0) {
        const media = content.media[0]; // Facebook posts typically handle one main media item
        
        if (media.type === "image") {
          // Post photo with message
          if (!media.path) {
            throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for Facebook photo posts");
          }

          if (!fs.existsSync(media.path)) {
            throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
          }

          const fileBuffer = fs.readFileSync(media.path);
          
          const response = await this.facebook.post(`/${pageId}/photos`, {
            source: fileBuffer,
            caption: content.text || "",
            published: true,
          });

          return response.data.post_id || response.data.id;
        } else if (media.type === "video") {
          // For videos, we need to use the videos endpoint
          if (!media.path) {
            throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for Facebook video posts");
          }

          if (!fs.existsSync(media.path)) {
            throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
          }

          const fileBuffer = fs.readFileSync(media.path);
          
          const response = await this.facebook.post(`/${pageId}/videos`, {
            source: fileBuffer,
            description: content.text || "",
            title: media.title || "Video",
            published: true,
          });

          return response.data.post_id || response.data.id;
        }
      }

      // Text-only post
      if (content.text) {
        const response = await this.facebook.post(`/${pageId}/feed`, {
          message: content.text,
        });

        return response.data.id;
      }

      throw new PostError(PostErrorType.INVALID_CONTENT, "No valid content to post");
    } catch (error: any) {
      if (error instanceof PostError) {
        throw error;
      }
      
      // Only treat specific Facebook API errors as API_ERROR
      if (error.response?.data?.error?.message) {
        throw new PostError(PostErrorType.API_ERROR, `Facebook API Error: ${error.response.data.error.message}`, error);
      }
      
      // Let generic errors bubble up to be handled as OTHER type
      throw error;
    }
  }

  async post(content: Content[]): Promise<PostResult[]> {
    const results: PostResult[] = [];

    // Facebook doesn't support threads like X, so we'll post each content item separately
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
            message: `Error posting to Facebook: ${error.message}`,
            details: error,
          });
        }
      }
    }

    return results;
  }
}