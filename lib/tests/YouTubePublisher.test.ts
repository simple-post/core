import fs from "node:fs";

import { google } from "googleapis";

import { YouTubePublisher } from "../src/publishers/youtube";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptions, Video } from "../src/types/post";

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
    publisher = new YouTubePublisher();
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
      delete process.env.YOUTUBE_CLIENT_ID;
      expect(() => new YouTubePublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "YouTube clientId, clientSecret and refreshToken are required"),
      );
    });
  });

  describe("validate", () => {
    it("should validate video with required fields", () => {
      const video: Video = {
        type: "video",
        path: "/path/to/video.mp4",
        title: "Test Video",
      };

      expect(() => publisher.validate(video)).not.toThrow();
    });

    it("should validate video with thumbnail", () => {
      const video: Video = {
        type: "video",
        path: "/path/to/video.mp4",
        title: "Test Video",
        thumbnailPath: "/path/to/thumbnail.jpg",
      };

      expect(() => publisher.validate(video)).not.toThrow();
    });

    it("should throw error if video is undefined", () => {
      expect(() => publisher.validate()).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post."),
      );
    });

    it("should throw error if video file does not exist", () => {
      const video: Video = {
        type: "video",
        path: "/path/to/missing.mp4",
        title: "Test Video",
      };

      mockedFs.existsSync.mockReturnValue(false);

      expect(() => publisher.validate(video)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video file not found at path: /path/to/missing.mp4"),
      );
    });

    it("should throw error if thumbnail file does not exist", () => {
      const video: Video = {
        type: "video",
        path: "/path/to/video.mp4",
        title: "Test Video",
        thumbnailPath: "/path/to/missing_thumbnail.jpg",
      };

      mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      expect(() => publisher.validate(video)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Thumbnail file not found at path: /path/to/missing_thumbnail.jpg",
        ),
      );
    });

    it("should throw error if title is missing", () => {
      const video: Video = {
        type: "video",
        path: "/path/to/video.mp4",
      };

      expect(() => publisher.validate(video)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post."),
      );
    });
  });

  describe("postContent", () => {
    const options: PostOptions = {};

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
            selfDeclaredMadeForKids: undefined,
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
        options: {
          youtube: {
            tags: ["tag1", "tag2"],
            categoryId: "22",
            playlistId: "playlist_123",
          },
          privacyStatus: "private",
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_789" },
      });
      mockYouTubeClient.playlistItems.insert.mockResolvedValue({});

      const result = await publisher.postContent(content, options);

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
            selfDeclaredMadeForKids: undefined,
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
        new PostError(PostErrorType.API_ERROR, "YouTube API Error: Video upload failed", apiError)
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
        new PostError(PostErrorType.API_ERROR, "Generic error", genericError)
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
        options: {
          youtube: {
            playlistId: "invalid_playlist",
          },
        },
      };

      mockYouTubeClient.videos.insert.mockResolvedValue({
        data: { id: "video_id_playlist_warn" },
      });
      mockYouTubeClient.playlistItems.insert.mockRejectedValue(new Error("Playlist not found"));

      const result = await publisher.postContent(content, options);

      // Should still succeed even if playlist addition fails
      expect(result).toEqual({ id: "video_id_playlist_warn", error: PostErrorType.NO_ERROR });
    });
  });

  describe("post", () => {
    const options: PostOptions = {};

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
