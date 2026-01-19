import fs from "node:fs";

import { google } from "googleapis";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, resolveThumbnailPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials, Video } from "../../types/post";
import type { youtube_v3 } from "googleapis";

export class YouTubePublisher extends Publisher {
  private youtube: youtube_v3.Youtube;

  constructor(options?: PostOptionsWithCredentials) {
    super("YouTube", options);

    // Validate the credentials
    if (!options?.youtube?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "YouTube credentials are required in options.youtube.credentials",
      );
    }

    const { clientId, clientSecret, refreshToken } = options.youtube.credentials;

    // Authenticate with the YouTube API
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    this.youtube = google.youtube({ version: "v3", auth });
  }

  private validate(video?: Video): asserts video is Video {
    // Check the video
    if (!video) throw new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.");

    // Check if the video has a valid source (path or url)
    if (!hasValidSource(video)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Video must have either a path or url");
    }

    // If path is provided, check if the video file exists
    if (video.path && !fs.existsSync(video.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Video file not found at path: ${video.path}`);
    }

    // Check the thumbnail if path is provided
    if (video.thumbnailPath && !fs.existsSync(video.thumbnailPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Thumbnail file not found at path: ${video.thumbnailPath}`);
    }

    // Check the title
    if (!video.title) throw new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post.");
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const video = content.media?.find((m) => m.type === "video");

    // Validate the video
    this.validate(video);

    const tempFileManager = new TempFileManager();

    try {
      // Resolve video path (download if URL)
      const { path: resolvedVideoPath, cleanup: videoCleanup } = await resolveMediaPath(video);
      tempFileManager.add(videoCleanup);

      // Resolve thumbnail path if provided (download if URL)
      const { path: resolvedThumbnailPath, cleanup: thumbnailCleanup } = await resolveThumbnailPath(video);
      tempFileManager.add(thumbnailCleanup);

      // Upload the video
      let videoId: string;
      try {
        const response = await this.youtube.videos.insert({
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: video.title,
              description: video.description,
              tags: options?.youtube?.tags,
              categoryId: options?.youtube?.categoryId,
            },
            status: {
              privacyStatus: options?.youtube?.publishAt ? "private" : options?.youtube?.privacyStatus,
              publishAt: options?.youtube?.publishAt ? new Date(options.youtube.publishAt).toISOString() : undefined,
              selfDeclaredMadeForKids: options?.youtube?.selfDeclaredMadeForKids ?? false,
            },
          },
          media: {
            body: fs.createReadStream(resolvedVideoPath),
          },
        });

        videoId = response.data.id!;
      } catch (error: any) {
        this.logger.error(error);

        let errorMessage = "Failed to upload video";

        if (error.response && error.response.data && error.response.data.error) {
          errorMessage = error.response.data.error.message;
        } else if (error.message) {
          errorMessage = error.message;
        }

        throw new PostError(PostErrorType.API_ERROR, errorMessage, error);
      }

      // Upload the thumbnail if provided
      try {
        if (resolvedThumbnailPath) {
          await this.youtube.thumbnails.set({
            videoId: videoId,
            media: {
              body: fs.createReadStream(resolvedThumbnailPath),
            },
          });
        }
      } catch (error: any) {
        this.logger.warn(`Failed to upload thumbnail for video ${videoId}: ${error}`);
      }

      // Add to playlist if playlist ID is provided
      try {
        if (options?.youtube?.playlistId) {
          await this.youtube.playlistItems.insert({
            part: ["snippet"],
            requestBody: {
              snippet: {
                playlistId: options?.youtube?.playlistId,
                resourceId: {
                  kind: "youtube#video",
                  videoId: videoId,
                },
              },
            },
          });
        }
      } catch (error: any) {
        this.logger.warn(`Failed to add video ${videoId} to playlist ${options?.youtube?.playlistId}: ${error}`);
      }

      return {
        id: videoId,
        error: PostErrorType.NO_ERROR,
      };
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
