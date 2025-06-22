import { YouTubePublisher } from "../src/publishers/youtube";
import { Content } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import { google } from "googleapis";
import fs from "fs";

// Mock the googleapis module
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

    it("should throw error for multiple posts", () => {
      const content: Content[] = [{ text: "First post" }, { text: "Second post" }];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "YouTube publisher only supports single posts.")
      );
    });

    it("should throw error when no video is provided", () => {
      const content: Content[] = [
        {
          text: "Post without video",
          media: [{ type: "image", path: "image.jpg" }],
        },
      ];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video is required for a YouTube post.")
      );
    });

    it("should throw error when video has no path", () => {
      const content: Content[] = [
        {
          media: [{ type: "video", title: "Test video" }],
        },
      ];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A video file path is required for YouTube.")
      );
    });

    it("should throw error when video file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const content: Content[] = [
        {
          media: [{ type: "video", path: "nonexistent.mp4", title: "Test video" }],
        },
      ];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video file not found at path: nonexistent.mp4")
      );
    });

    it("should throw error when thumbnail file does not exist", () => {
      mockFs.existsSync.mockImplementation((path) => {
        if (path === "video.mp4") return true;
        if (path === "nonexistent_thumbnail.jpg") return false;
        return false;
      });

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              thumbnailPath: "nonexistent_thumbnail.jpg",
            },
          ],
        },
      ];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Thumbnail file not found at path: nonexistent_thumbnail.jpg")
      );
    });

    it("should throw error when video has no title", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          media: [{ type: "video", path: "video.mp4" }],
        },
      ];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "A title is required for a YouTube post.")
      );
    });

    it("should pass validation for valid content", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
              thumbnailPath: "thumbnail.jpg",
            },
          ],
        },
      ];

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should pass validation for valid content without thumbnail", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
            },
          ],
        },
      ];

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

    it("should return validation error when content is invalid", async () => {
      const content: Content[] = [{ text: "Post without video" }];

      const results = await publisher.post(content);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "A video is required for a YouTube post.",
      });
    });

    it("should successfully upload video with basic options", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
            },
          ],
          options: {
            privacyStatus: "unlisted",
          },
        },
      ];

      const results = await publisher.post(content);

      expect(mockYouTube.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Test video",
            description: "Test description",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: "unlisted",
            selfDeclaredMadeForKids: undefined,
          },
        },
        media: {
          body: "mock_stream",
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should successfully upload video with YouTube-specific options", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
            },
          ],
          options: {
            privacyStatus: "public",
            youtubeSpecific: {
              tags: ["tag1", "tag2"],
              categoryId: "22",
              selfDeclaredMadeForKids: false,
            },
          },
        },
      ];

      const results = await publisher.post(content);

      expect(mockYouTube.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Test video",
            description: "Test description",
            tags: ["tag1", "tag2"],
            categoryId: "22",
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: "mock_stream",
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should upload thumbnail when provided", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);
      mockYouTube.thumbnails.set.mockResolvedValue({});

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
              thumbnailPath: "thumbnail.jpg",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(mockYouTube.thumbnails.set).toHaveBeenCalledWith({
        videoId: "test_video_id",
        media: {
          body: "mock_stream",
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should add video to playlist when playlist ID is provided", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);
      mockYouTube.playlistItems.insert.mockResolvedValue({});

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
            },
          ],
          options: {
            youtubeSpecific: {
              playlistId: "test_playlist_id",
            },
          },
        },
      ];

      const results = await publisher.post(content);

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

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle video upload API error", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid video format",
            },
          },
        },
      };
      mockYouTube.videos.insert.mockRejectedValue(apiError);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "YouTube API Error: Invalid video format",
        details: apiError,
      });
    });

    it("should handle generic video upload error", async () => {
      const genericError = new Error("Network error");
      mockYouTube.videos.insert.mockRejectedValue(genericError);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Network error",
        details: genericError,
      });
    });

    it("should handle unknown video upload error", async () => {
      const unknownError = { some: "unknown error" };
      mockYouTube.videos.insert.mockRejectedValue(unknownError);

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "An unknown error occurred while uploading to YouTube.",
        details: unknownError,
      });
    });

    it("should continue with video upload even if thumbnail upload fails", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);
      mockYouTube.thumbnails.set.mockRejectedValue(new Error("Thumbnail upload failed"));

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              thumbnailPath: "thumbnail.jpg",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(mockYouTube.thumbnails.set).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should continue with video upload even if playlist addition fails", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);
      mockYouTube.playlistItems.insert.mockRejectedValue(new Error("Playlist addition failed"));

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
            },
          ],
          options: {
            youtubeSpecific: {
              playlistId: "test_playlist_id",
            },
          },
        },
      ];

      const results = await publisher.post(content);

      expect(mockYouTube.playlistItems.insert).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle complete workflow with thumbnail and playlist", async () => {
      const mockVideoResponse = {
        data: { id: "test_video_id" },
      };
      mockYouTube.videos.insert.mockResolvedValue(mockVideoResponse);
      mockYouTube.thumbnails.set.mockResolvedValue({});
      mockYouTube.playlistItems.insert.mockResolvedValue({});

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
              description: "Test description",
              thumbnailPath: "thumbnail.jpg",
            },
          ],
          options: {
            privacyStatus: "private",
            youtubeSpecific: {
              tags: ["test", "video"],
              categoryId: "22",
              playlistId: "test_playlist_id",
              selfDeclaredMadeForKids: true,
            },
          },
        },
      ];

      const results = await publisher.post(content);

      // Verify video upload
      expect(mockYouTube.videos.insert).toHaveBeenCalledWith({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Test video",
            description: "Test description",
            tags: ["test", "video"],
            categoryId: "22",
          },
          status: {
            privacyStatus: "private",
            selfDeclaredMadeForKids: true,
          },
        },
        media: {
          body: "mock_stream",
        },
      });

      // Verify thumbnail upload
      expect(mockYouTube.thumbnails.set).toHaveBeenCalledWith({
        videoId: "test_video_id",
        media: {
          body: "mock_stream",
        },
      });

      // Verify playlist addition
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

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "test_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should return OTHER error for non-PostError validation failures", async () => {
      // Mock validate to throw a generic error (not PostError)
      jest.spyOn(publisher, "validate").mockImplementation(() => {
        throw new Error("Generic validation error");
      });

      const content: Content[] = [
        {
          media: [
            {
              type: "video",
              path: "video.mp4",
              title: "Test video",
            },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.OTHER,
        message: "An unknown error occurred while YouTube post.",
      });
    });
  });
});
