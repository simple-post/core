import { Content } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import { google, youtube_v3 } from "googleapis";
import fs from "fs";

export class YouTubePublisher extends Publisher {
  private youtube: youtube_v3.Youtube;

  constructor() {
    super();

    let auth: any;

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      // Try to use the credentials from the environment variables
      auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
    } else {
      // Try to use Application Default Credentials
      auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      });
    }

    if (!auth) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "No credentials found for YouTube");
    }

    this.youtube = google.youtube({ version: "v3", auth });
  }

  validate(content: Content[]): void {
    if (content.length !== 1)
      throw new PostError(PostErrorType.INVALID_CONTENT, "YouTube publisher only supports single posts.");

    const postContent = content[0];
    const video = postContent.media?.find((m) => m.type === "video");

    // Check the video
    if (!video) throw new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.");

    if (!video.path) throw new PostError(PostErrorType.INVALID_CONTENT, "A video file path is required for YouTube.");

    if (!fs.existsSync(video.path))
      throw new PostError(PostErrorType.INVALID_CONTENT, `Video file not found at path: ${video.path}`);

    // Check the thumbnail
    if (video.thumbnailPath && !fs.existsSync(video.thumbnailPath))
      throw new PostError(PostErrorType.INVALID_CONTENT, `Thumbnail file not found at path: ${video.thumbnailPath}`);

    // Check the title
    if (!video.title) throw new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post.");
  }

  async post(content: Content[]): Promise<PostResult[]> {
    // Validate the content
    try {
      this.validate(content);
    } catch (error) {
      if (error instanceof PostError) {
        return [{ error: error.errorType, message: error.message }];
      }
      return [{ error: PostErrorType.OTHER, message: "An unknown error occurred while YouTube post." }];
    }

    const postContent = content[0];
    const video = postContent.media?.find((m) => m.type === "video");

    let videoId: string;

    // Upload the video
    try {
      const response = await this.youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: video!.title,
            description: video!.description,
            tags: postContent.options?.youtubeSpecific?.tags,
            categoryId: postContent.options?.youtubeSpecific?.categoryId,
          },
          status: {
            privacyStatus: postContent.options?.privacyStatus,
            selfDeclaredMadeForKids: postContent.options?.youtubeSpecific?.selfDeclaredMadeForKids,
          },
        },
        media: {
          body: fs.createReadStream(video!.path!),
        },
      });

      videoId = response.data.id!;
    } catch (error: any) {
      let errorMessage = "An unknown error occurred while uploading to YouTube.";
      if (error.response && error.response.data && error.response.data.error) {
        errorMessage = `YouTube API Error: ${error.response.data.error.message}`;
      } else if (error.message) {
        errorMessage = error.message;
      }

      return [
        {
          error: PostErrorType.API_ERROR,
          message: errorMessage,
          details: error,
        },
      ];
    }

    // Upload the thumbnail if provided
    try {
      if (video!.thumbnailPath) {
        await this.youtube.thumbnails.set({
          videoId: videoId,
          media: {
            body: fs.createReadStream(video!.thumbnailPath),
          },
        });
      }
    } catch (error: any) {
      // TODO: log error
    }

    // Add to playlist if playlist ID is provided
    try {
      if (postContent.options?.youtubeSpecific?.playlistId) {
        await this.youtube.playlistItems.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              playlistId: postContent.options?.youtubeSpecific?.playlistId,
              resourceId: {
                kind: "youtube#video",
                videoId: videoId,
              },
            },
          },
        });
      }
    } catch (error: any) {
      // TODO: log error
    }

    return [
      {
        id: videoId,
        error: PostErrorType.NO_ERROR,
      },
    ];
  }
}
