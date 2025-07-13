import { Content, PostOptions, Video } from "../../types/post";
import { Publisher } from "../base";
import { PostError, PostErrorType, PostResult } from "../../types";
import { google, youtube_v3 } from "googleapis";
import fs from "fs";

export class YouTubePublisher extends Publisher {
  private youtube: youtube_v3.Youtube;

  constructor(options?: PostOptions) {
    super("YouTube", options);

    // Check if the credentials are valid
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "YouTube clientId, clientSecret and refreshToken are required"
      );
    }

    // Authenticate with the YouTube API
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    this.youtube = google.youtube({ version: "v3", auth });
  }

  validate(video?: Video): asserts video is Video {
    // Check the video
    if (!video) throw new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.");

    // Check if the video file exists
    if (!fs.existsSync(video.path))
      throw new PostError(PostErrorType.INVALID_CONTENT, `Video file not found at path: ${video.path}`);

    // Check the thumbnail
    if (video.thumbnailPath && !fs.existsSync(video.thumbnailPath))
      throw new PostError(PostErrorType.INVALID_CONTENT, `Thumbnail file not found at path: ${video.thumbnailPath}`);

    // Check the title
    if (!video.title) throw new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post.");
  }

  async postContent(content: Content, options: PostOptions): Promise<PostResult> {
    const video = content.media?.find((m) => m.type === "video");

    // Validate the video
    this.validate(video);

    // Upload the video
    let videoId: string;
    try {
      const response = await this.youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: video.title,
            description: video.description,
            tags: content.options?.youtube?.tags,
            categoryId: content.options?.youtube?.categoryId,
          },
          status: {
            privacyStatus: content.options?.privacyStatus,
            selfDeclaredMadeForKids: content.options?.youtube?.selfDeclaredMadeForKids,
          },
        },
        media: {
          body: fs.createReadStream(video.path),
        },
      });

      videoId = response.data.id!;
    } catch (error: any) {
      this.logger.error(error);

      let errorMessage = "An unknown error occurred while uploading to YouTube.";

      if (error.response && error.response.data && error.response.data.error) {
        errorMessage = `YouTube API Error: ${error.response.data.error.message}`;
      } else if (error.message) {
        errorMessage = error.message;
      }

      return { error: PostErrorType.API_ERROR, message: errorMessage, details: error };
    }

    // Upload the thumbnail if provided
    try {
      if (video.thumbnailPath) {
        await this.youtube.thumbnails.set({
          videoId: videoId,
          media: {
            body: fs.createReadStream(video.thumbnailPath),
          },
        });
      }
    } catch (error: any) {
      this.logger.warn(`Failed to upload thumbnail for video ${videoId}: ${error}`);
    }

    // Add to playlist if playlist ID is provided
    try {
      if (content.options?.youtube?.playlistId) {
        await this.youtube.playlistItems.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              playlistId: content.options?.youtube?.playlistId,
              resourceId: {
                kind: "youtube#video",
                videoId: videoId,
              },
            },
          },
        });
      }
    } catch (error: any) {
      this.logger.warn(`Failed to add video ${videoId} to playlist ${content.options?.youtube?.playlistId}: ${error}`);
    }

    return {
      id: videoId,
      error: PostErrorType.NO_ERROR,
    };
  }
}
