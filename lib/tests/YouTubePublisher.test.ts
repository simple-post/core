import { YouTubePublisher } from "../src/publishers/youtube";
import { Content } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import { google } from "googleapis";
import fs from "fs";

// Mock dependencies
jest.mock("googleapis");
jest.mock("fs");

const mockGoogle = google as jest.Mocked<typeof google>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe("YouTubePublisher", () => {
  let publisher: YouTubePublisher;
  let mockYouTube: any;
  let mockOAuth2: any;
  let mockGoogleAuth: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up mock auth objects
    mockOAuth2 = {
      setCredentials: jest.fn(),
    };
    mockGoogleAuth = {};

    // Set up mock YouTube API client
    mockYouTube = {
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

    // Mock google.auth.OAuth2 and google.auth.GoogleAuth constructors
    mockGoogle.auth = {
      OAuth2: jest.fn(() => mockOAuth2),
      GoogleAuth: jest.fn(() => mockGoogleAuth),
    } as any;

    // Mock google.youtube
    mockGoogle.youtube.mockReturnValue(mockYouTube);

    // Mock fs functions
    mockFs.existsSync = jest.fn();
    mockFs.createReadStream = jest.fn();
  });

  describe("constructor", () => {
    it("should initialize with OAuth2 credentials from environment variables", () => {
      process.env.YOUTUBE_CLIENT_ID = "test_client_id";
      process.env.YOUTUBE_CLIENT_SECRET = "test_client_secret";
      process.env.YOUTUBE_REFRESH_TOKEN = "test_refresh_token";

      publisher = new YouTubePublisher();

      expect(mockGoogle.auth.OAuth2).toHaveBeenCalledWith("test_client_id", "test_client_secret");
      expect(mockOAuth2.setCredentials).toHaveBeenCalledWith({ refresh_token: "test_refresh_token" });
      expect(mockGoogle.youtube).toHaveBeenCalledWith({ version: "v3", auth: mockOAuth2 });
    });

    it("should initialize with Application Default Credentials when env vars are missing", () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      delete process.env.YOUTUBE_CLIENT_SECRET;
      delete process.env.YOUTUBE_REFRESH_TOKEN;

      publisher = new YouTubePublisher();

      expect(mockGoogle.auth.GoogleAuth).toHaveBeenCalledWith({
        scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      });
      expect(mockGoogle.youtube).toHaveBeenCalledWith({ version: "v3", auth: mockGoogleAuth });
    });
  });

  describe("validate", () => {
    beforeEach(() => {
      process.env.YOUTUBE_CLIENT_ID = "test_client_id";
      process.env.YOUTUBE_CLIENT_SECRET = "test_client_secret";
      process.env.YOUTUBE_REFRESH_TOKEN = "test_refresh_token";
      publisher = new YouTubePublisher();
    });

    it("should throw error when no video is provided (text only)", () => {
      const content: Content = { text: "Post without video" };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.")
      );
    });

    it("should throw error when media array is empty", () => {
      const content: Content = { text: "Post with empty media", media: [] };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.")
      );
    });

    it("should throw error when media type is not video", () => {
      const content: Content = {
        text: "Post with image",
        media: [{ type: "image", path: "image.jpg" }],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.")
      );
    });

    it("should throw error when video has no path", () => {
      const content: Content = {
        media: [{ type: "video", title: "Test video" }],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video file path is required for YouTube.")
      );
    });

    it("should throw error when video file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const content: Content = {
        media: [{ type: "video", path: "nonexistent.mp4", title: "Test video" }],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video file not found at path: nonexistent.mp4")
      );
    });

    it("should throw error when video has no title", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content = {
        media: [{ type: "video", path: "video.mp4" }],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post.")
      );
    });

    it("should throw error when thumbnail file does not exist", () => {
      mockFs.existsSync.mockImplementation((path) => {
        if (path === "video.mp4") return true;
        if (path === "nonexistent_thumbnail.jpg") return false;
        return false;
      });

      const content: Content = {
        media: [
          {
            type: "video",
            path: "video.mp4",
            title: "Test video",
            thumbnailPath: "nonexistent_thumbnail.jpg",
          },
        ],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Thumbnail file not found at path: nonexistent_thumbnail.jpg")
      );
    });

    it("should pass validation for valid video post", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content = {
        media: [{ type: "video", path: "video.mp4", title: "Valid video" }],
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should pass validation for video with YouTube-specific options", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content = {
        media: [{ type: "video", path: "video.mp4", title: "Video with options" }],
        options: {
          youtube: {
            tags: ["test", "video"],
            categoryId: "22",
          },
        },
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });
  });

  describe("post", () => {
    beforeEach(() => {
      process.env.YOUTUBE_CLIENT_ID = "test_client_id";
      process.env.YOUTUBE_CLIENT_SECRET = "test_client_secret";
      process.env.YOUTUBE_REFRESH_TOKEN = "test_refresh_token";
      publisher = new YouTubePublisher();
      mockFs.existsSync.mockReturnValue(true);
      mockFs.createReadStream.mockReturnValue("mock_stream" as any);
    });

    it("should return validation error for invalid content", async () => {
      const content: Content = { text: "No video" };

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "A video is required for a YouTube post.",
      });
    });

    it("should successfully upload video", async () => {
      mockYouTube.videos.insert.mockResolvedValue({
        data: { id: "test_video_id" },
      });

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Test video upload" }],
      };

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should upload video with custom options", async () => {
      mockYouTube.videos.insert.mockResolvedValue({
        data: { id: "test_video_id_with_options" },
      });

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Video with custom options" }],
        options: {
          youtube: {
            tags: ["test", "custom"],
            categoryId: "22",
            selfDeclaredMadeForKids: false,
          },
        },
      };

      const result = await publisher.post(content, {});

      expect(mockYouTube.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Video with custom options",
            description: undefined,
            tags: ["test", "custom"],
            categoryId: "22",
          },
          status: {
            privacyStatus: undefined,
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock_stream",
        },
      });

      expect(result).toEqual({
        id: "test_video_id_with_options",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle API errors during upload", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Upload failed",
            },
          },
        },
      };
      mockYouTube.videos.insert.mockRejectedValue(apiError);

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Will fail" }],
      };

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "YouTube API Error: Upload failed",
        details: apiError,
      });
    });

    it("should handle network errors", async () => {
      const networkError = new Error("ECONNRESET");
      mockYouTube.videos.insert.mockRejectedValue(networkError);

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Network error test" }],
      };

      const result = await publisher.post(content, {});

      expect(result.error).toBe(PostErrorType.API_ERROR);
      expect(result.message).toContain("ECONNRESET");
    });

    it("should handle videos with thumbnail", async () => {
      mockYouTube.videos.insert.mockResolvedValue({
        data: { id: "test_video_with_thumbnail" },
      });
      mockYouTube.thumbnails.set.mockResolvedValue({});

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Video with thumbnail", thumbnailPath: "thumbnail.jpg" }],
      };

      const result = await publisher.post(content, {});

      expect(mockYouTube.thumbnails.set).toHaveBeenCalledWith({
        videoId: "test_video_with_thumbnail",
        media: {
          body: "mock_stream",
        },
      });

      expect(result).toEqual({
        id: "test_video_with_thumbnail",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle videos with description", async () => {
      mockYouTube.videos.insert.mockResolvedValue({
        data: { id: "test_video_with_description" },
      });

      const content: Content = {
        media: [
          { type: "video", path: "test.mp4", title: "Video title", description: "This is the video description" },
        ],
      };

      const result = await publisher.post(content, {});

      expect(mockYouTube.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Video title",
            description: "This is the video description",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: undefined,
            selfDeclaredMadeForKids: undefined,
          },
        },
        media: {
          body: "mock_stream",
        },
      });

      expect(result).toEqual({
        id: "test_video_with_description",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should add video to playlist when playlist ID is provided", async () => {
      mockYouTube.videos.insert.mockResolvedValue({
        data: { id: "test_video_id" },
      });
      mockYouTube.playlistItems.insert.mockResolvedValue({});

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Test video" }],
        options: {
          youtube: {
            playlistId: "test_playlist_id",
          },
        },
      };

      const result = await publisher.post(content, {});

      expect(mockYouTube.playlistItems.insert).toHaveBeenCalledWith({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId: "test_playlist_id",
            resourceId: {
              kind: "youtube#video",
              videoId: "test_video_id",
            },
          },
        },
      });

      expect(result).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle validation errors", async () => {
      const content: Content = {
        media: [{ type: "image", path: "image.jpg" }],
      };

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "A video is required for a YouTube post.",
      });
    });

    it("should handle generic errors", async () => {
      const genericError = new Error("Unexpected error");
      mockYouTube.videos.insert.mockRejectedValue(genericError);

      const content: Content = {
        media: [{ type: "video", path: "test.mp4", title: "Generic error test" }],
      };

      const result = await publisher.post(content, {});

      expect(result.error).toBe(PostErrorType.API_ERROR);
      expect(result.message).toContain("Unexpected error");
    });
  });
});
