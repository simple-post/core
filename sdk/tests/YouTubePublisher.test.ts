import fs from "node:fs";

import { google } from "googleapis";

import { YouTubePublisher } from "../src/publishers/youtube";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn(),
    },
    youtube: jest.fn(),
  },
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
  statSync: jest.fn(),
}));

jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

const mockedGoogle = google as jest.Mocked<typeof google>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("YouTubePublisher", () => {
  let publisher: YouTubePublisher;
  let mockYouTubeClient: any;
  let mockAuth: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables
    process.env.YOUTUBE_CLIENT_ID = "test_client_id";
    process.env.YOUTUBE_CLIENT_SECRET = "test_client_secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "test_refresh_token";

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.createReadStream.mockReturnValue("mock-stream" as any);
    mockedFs.statSync.mockReturnValue({ size: 1024 * 1024 } as any); // 1 MB mock file

    // Create mock YouTube client
    mockYouTubeClient = {
      videos: {
        insert: jest.fn(),
      },
      thumbnails: {
        set: jest.fn(),
      },
      playlistItems: {
        insert: jest.fn(),
      },
    };

    // Create mock auth
    mockAuth = {
      setCredentials: jest.fn(),
    };

    // Mock google.auth.OAuth2 constructor
    mockedGoogle.auth = {
      OAuth2: jest.fn().mockImplementation(() => mockAuth),
    } as any;

    // Mock google.youtube
    mockedGoogle.youtube.mockReturnValue(mockYouTubeClient);

    // Create a new publisher instance
    publisher = new YouTubePublisher({
      youtube: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          refreshToken: "test_refresh_token",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should initialize with valid credentials", () => {
      expect(mockedGoogle.auth.OAuth2).toHaveBeenCalledWith("test_client_id", "test_client_secret");
      expect(mockAuth.setCredentials).toHaveBeenCalledWith({
        refresh_token: "test_refresh_token",
      });
      expect(mockedGoogle.youtube).toHaveBeenCalledWith({
        version: "v3",
        auth: mockAuth,
      });
    });

    it("should throw error if credentials are missing", () => {
      expect(() => new YouTubePublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "YouTube credentials are required in options.youtube.credentials",
        ),
      );
    });
  });

  describe("postContent", () => {
    const options: PostOptionsWithCredentials = {
      youtube: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          refreshToken: "test_refresh_token",
        },
      },
    };

    it("should post video successfully", async () => {
      const content: Content = {
        text: "Video description",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
            description: "Test video description",
          },
        ],
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_123" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockYouTubeClient.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Test Video",
            description: "Test video description",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: undefined,
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "video_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should post video with thumbnail successfully", async () => {
      const content: Content = {
        text: "Video with thumbnail",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
            thumbnailPath: "/path/to/thumbnail.jpg",
          },
        ],
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_456" },
      });
      mockYouTubeClient.thumbnails.set.mockResolvedValue({});

      const result = await publisher.postContent(content, options);

      expect(mockYouTubeClient.videos.insert).toHaveBeenCalled();
      expect(mockYouTubeClient.thumbnails.set).toHaveBeenCalledWith({
        videoId: "video_id_456",
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "video_id_456", error: PostErrorType.NO_ERROR });
    });

    it("should post video with YouTube-specific options", async () => {
      const content: Content = {
        text: "Video with options",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
          },
        ],
      };

      const optionsWithYouTube: PostOptionsWithCredentials = {
        youtube: {
          privacyStatus: "private",
          tags: ["tag1", "tag2"],
          categoryId: "22",
          playlistId: "playlist_123",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_789" },
      });
      mockYouTubeClient.playlistItems.insert.mockResolvedValue({});

      const result = await publisher.postContent(content, optionsWithYouTube);

      expect(mockYouTubeClient.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Test Video",
            description: undefined,
            tags: ["tag1", "tag2"],
            categoryId: "22",
          },
          status: {
            privacyStatus: "private",
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock-stream",
        },
      });
      expect(mockYouTubeClient.playlistItems.insert).toHaveBeenCalledWith({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId: "playlist_123",
            resourceId: {
              kind: "youtube#video",
              videoId: "video_id_789",
            },
          },
        },
      });
      expect(result).toEqual({ id: "video_id_789", error: PostErrorType.NO_ERROR });
    });

    it("should handle content without video", async () => {
      const content: Content = {
        text: "No video content",
      };

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post."),
      );
    });

    it("should handle content with image instead of video", async () => {
      const content: Content = {
        text: "Image content",
        media: [
          {
            type: "image",
            path: "/path/to/image.jpg",
          },
        ],
      };

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post."),
      );
    });

    it("should handle API errors during video upload", async () => {
      const content: Content = {
        text: "Will fail",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
          },
        ],
      };

      const apiError = {
        response: {
          data: {
            error: {
              message: "Video upload failed",
            },
          },
        },
      };
      mockYouTubeClient.videos.insert.mockRejectedValue(apiError);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Video upload failed", apiError),
      );
    });

    it("should handle generic errors during video upload", async () => {
      const content: Content = {
        text: "Will fail generically",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
          },
        ],
      };

      const genericError = new Error("Generic error");
      mockYouTubeClient.videos.insert.mockRejectedValue(genericError);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Generic error", genericError),
      );
    });

    it("should warn if thumbnail upload fails", async () => {
      const content: Content = {
        text: "Thumbnail upload will fail",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
            thumbnailPath: "/path/to/thumbnail.jpg",
          },
        ],
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_warn" },
      });
      mockYouTubeClient.thumbnails.set.mockRejectedValue(new Error("Thumbnail upload failed"));

      const result = await publisher.postContent(content, options);

      // Should still succeed even if thumbnail upload fails
      expect(result).toEqual({ id: "video_id_warn", error: PostErrorType.NO_ERROR });
    });

    it("should warn if playlist addition fails", async () => {
      const content: Content = {
        text: "Playlist addition will fail",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
          },
        ],
      };

      const optionsWithPlaylist: PostOptionsWithCredentials = {
        youtube: {
          playlistId: "invalid_playlist",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_playlist_warn" },
      });
      mockYouTubeClient.playlistItems.insert.mockRejectedValue(new Error("Playlist not found"));

      const result = await publisher.postContent(content, optionsWithPlaylist);

      // Should still succeed even if playlist addition fails
      expect(result).toEqual({ id: "video_id_playlist_warn", error: PostErrorType.NO_ERROR });
    });

    it("should schedule a video correctly", async () => {
      const scheduledTime = "2024-12-25T12:00:00Z";
      const content: Content = {
        text: "Scheduled video",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Scheduled Video",
            description: "This video is scheduled",
          },
        ],
      };

      const optionsWithSchedule: PostOptionsWithCredentials = {
        youtube: {
          publishAt: scheduledTime,
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "scheduled_video_123" },
      });

      const result = await publisher.postContent(content, optionsWithSchedule);

      expect(mockYouTubeClient.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Scheduled Video",
            description: "This video is scheduled",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: "private",
            publishAt: "2024-12-25T12:00:00.000Z",
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "scheduled_video_123", error: PostErrorType.NO_ERROR });
    });

    it("should use normal privacy status when not scheduling", async () => {
      const content: Content = {
        text: "Regular video",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Regular Video",
          },
        ],
      };

      const optionsWithPrivacy: PostOptionsWithCredentials = {
        youtube: {
          privacyStatus: "public",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "regular_video_123" },
      });

      const result = await publisher.postContent(content, optionsWithPrivacy);

      expect(mockYouTubeClient.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Regular Video",
            description: undefined,
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: "public",
            publishAt: undefined,
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "regular_video_123", error: PostErrorType.NO_ERROR });
    });
  });

  describe("post", () => {
    const options: PostOptionsWithCredentials = {
      youtube: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          refreshToken: "test_refresh_token",
        },
      },
    };

    it("should post content successfully and return PostResult", async () => {
      const content: Content = {
        text: "Test post",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
          },
        ],
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_post" },
      });

      const result = await publisher.post(content, options);

      expect(result).toEqual({ id: "video_id_post", error: PostErrorType.NO_ERROR });
    });

    it("should handle errors and return PostResult with error", async () => {
      const content: Content = {
        text: "No video content",
      };

      const result = await publisher.post(content, options);

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "A video is required for a YouTube post.",
        details: undefined,
      });
    });
  });
});
