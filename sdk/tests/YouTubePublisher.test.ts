import fs from "node:fs";

import { google } from "googleapis";

import { YouTubePublisher } from "../src/publishers/youtube";
import { uploadYouTubeVideo } from "../src/publishers/youtube/resumable-upload";
import { YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES, YOUTUBE_MAX_VIDEO_SIZE_BYTES } from "../src/publishers/youtube/validation";
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

// The resumable transport is covered by YouTubeResumableUpload.test.ts; here it
// is mocked so these tests verify metadata, scheduling and thumbnail behavior.
jest.mock("../src/publishers/youtube/resumable-upload", () => ({
  uploadYouTubeVideo: jest.fn(),
  YOUTUBE_UPLOAD_ORIGIN: "https://www.googleapis.com",
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
const mockedUpload = jest.mocked(uploadYouTubeVideo);

const expectedUpload = (filePath: string, size: number, metadata: unknown) =>
  expect.objectContaining({ filePath, size, metadata, getAuthorization: expect.any(Function) });

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

    // Create mock YouTube client. videos.insert stays present only to prove the
    // multipart path is never used anymore.
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
      getRequestHeaders: jest.fn().mockResolvedValue(new Headers({ authorization: "Bearer test_access_token" })),
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
    it("should initialize with valid credentials and a bounded token transport", () => {
      expect(mockedGoogle.auth.OAuth2).toHaveBeenCalledWith({
        clientId: "test_client_id",
        clientSecret: "test_client_secret",
        transporterOptions: { timeout: 30_000 },
      });
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

      mockedUpload.mockResolvedValue({ videoId: "video_id_123" });

      const result = await publisher.postContent(content, options);

      expect(mockedUpload).toHaveBeenCalledTimes(1);
      expect(mockedUpload).toHaveBeenCalledWith(
        expectedUpload("/path/to/video.mp4", 1024 * 1024, {
          snippet: {
            title: "Test Video",
            description: "Test video description",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: undefined,
            publishAt: undefined,
            selfDeclaredMadeForKids: false,
          },
        }),
      );
      expect(mockYouTubeClient.videos.insert).not.toHaveBeenCalled();
      expect(mockedFs.createReadStream).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "video_id_123", error: PostErrorType.NO_ERROR });
    });

    it("hands the transport a header-only authorization callback backed by the stored OAuth2 client", async () => {
      mockedUpload.mockResolvedValue({ videoId: "video_id_auth" });
      await publisher.postContent(
        { text: "Auth", media: [{ type: "video", path: "/path/to/video.mp4", title: "Auth" }] },
        options,
      );
      const { getAuthorization, logger } = mockedUpload.mock.calls[0][0];
      await expect(getAuthorization()).resolves.toBe("Bearer test_access_token");
      expect(mockAuth.getRequestHeaders).toHaveBeenCalledWith("https://www.googleapis.com");
      expect(logger).toBe(publisher.logger);

      mockAuth.getRequestHeaders.mockResolvedValueOnce(new Headers());
      await expect(getAuthorization()).rejects.toThrow("YouTube authorization header unavailable");
      const revoked = Object.assign(new Error("invalid_grant"), { response: { status: 400 } });
      mockAuth.getRequestHeaders.mockRejectedValueOnce(revoked);
      await expect(getAuthorization()).rejects.toBe(revoked);
    });

    it("rejects an oversized derived title before uploading and accepts an explicit shorter title", async () => {
      const text = "Underwater ambience. ".repeat(23);
      const content: Content = { text, media: [{ type: "video", path: "/path/to/video.mp4" }] };
      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
      });
      expect(mockedUpload).not.toHaveBeenCalled();
      mockedUpload.mockResolvedValue({ videoId: "video_id_123" });
      await publisher.postContent(content, {
        ...options,
        youtube: { ...options.youtube!, title: "Underwater ambience" },
      });
      expect(mockedUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            snippet: expect.objectContaining({ title: "Underwater ambience", description: text.trim() }),
          }),
        }),
      );
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

      mockedUpload.mockResolvedValue({ videoId: "video_id_456" });
      mockYouTubeClient.thumbnails.set.mockResolvedValue({});

      const result = await publisher.postContent(content, options);

      expect(mockedUpload).toHaveBeenCalled();
      expect(mockYouTubeClient.thumbnails.set).toHaveBeenCalledWith({
        videoId: "video_id_456",
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "video_id_456", error: PostErrorType.NO_ERROR });
    });

    it("rejects an oversized resolved video before upload", async () => {
      mockedFs.statSync.mockReturnValue({ size: YOUTUBE_MAX_VIDEO_SIZE_BYTES + 1 } as any);

      await expect(
        publisher.postContent(
          {
            text: "Oversized video",
            media: [{ type: "video", path: "/path/to/video.mp4", title: "Oversized" }],
          },
          options,
        ),
      ).rejects.toThrow("YouTube videos cannot exceed 256 GB.");
      expect(mockedUpload).not.toHaveBeenCalled();
    });

    it("rejects an oversized custom thumbnail before uploading the video", async () => {
      mockedFs.statSync.mockImplementation((filePath) =>
        String(filePath).endsWith("thumbnail.jpg")
          ? ({ size: YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES + 1 } as any)
          : ({ size: 1024 * 1024 } as any),
      );

      await expect(
        publisher.postContent(
          {
            text: "Oversized thumbnail",
            media: [
              {
                type: "video",
                path: "/path/to/video.mp4",
                title: "Thumbnail check",
                thumbnailPath: "/path/to/thumbnail.jpg",
              },
            ],
          },
          options,
        ),
      ).rejects.toThrow("YouTube custom thumbnails cannot exceed 2 MB.");
      expect(mockedUpload).not.toHaveBeenCalled();
    });

    it("should use YouTube-specific thumbnail over media thumbnail", async () => {
      const content: Content = {
        text: "Video with custom thumbnail option",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
            thumbnailPath: "/path/to/generated-thumbnail.jpg",
          },
        ],
      };

      const optionsWithThumbnail: PostOptionsWithCredentials = {
        youtube: {
          thumbnailPath: "/path/to/custom-thumbnail.jpg",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockedUpload.mockResolvedValue({ videoId: "video_id_custom_thumbnail" });
      mockYouTubeClient.thumbnails.set.mockResolvedValue({});

      const result = await publisher.postContent(content, optionsWithThumbnail);

      expect(mockedFs.createReadStream).toHaveBeenCalledWith("/path/to/custom-thumbnail.jpg");
      expect(mockYouTubeClient.thumbnails.set).toHaveBeenCalledWith({
        videoId: "video_id_custom_thumbnail",
        media: {
          body: "mock-stream",
        },
      });
      expect(result).toEqual({ id: "video_id_custom_thumbnail", error: PostErrorType.NO_ERROR });
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
          title: "Custom upload title",
          description: "Custom upload description",
          privacyStatus: "private",
          tags: ["tag1", "tag2"],
          categoryId: "22",
          selfDeclaredMadeForKids: true,
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockedUpload.mockResolvedValue({ videoId: "video_id_789" });

      const result = await publisher.postContent(content, optionsWithYouTube);

      expect(mockedUpload).toHaveBeenCalledWith(
        expectedUpload("/path/to/video.mp4", 1024 * 1024, {
          snippet: {
            title: "Custom upload title",
            description: "Custom upload description",
            tags: ["tag1", "tag2"],
            categoryId: "22",
          },
          status: {
            privacyStatus: "private",
            publishAt: undefined,
            selfDeclaredMadeForKids: true,
          },
        }),
      );
      expect(mockYouTubeClient.playlistItems.insert).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "video_id_789", error: PostErrorType.NO_ERROR });
    });

    it("should handle content without video", async () => {
      const content: Content = {
        text: "No video content",
      };

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("YouTube content validation failed");
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

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("YouTube content validation failed");
    });

    it.each([
      [PostErrorType.RATE_LIMIT_ERROR, "youtube_upload_limit"],
      [PostErrorType.PUBLISH_REJECTED, "youtube_init_rejected"],
      [PostErrorType.CREDENTIALS_ERROR, "youtube_credentials"],
      [PostErrorType.API_ERROR, "youtube_retry_budget"],
    ])("propagates a %s transport outcome unchanged without a thumbnail or second upload", async (type, code) => {
      const content: Content = {
        text: "Will fail",
        media: [{ type: "video", path: "/path/to/video.mp4", title: "Test Video", thumbnailPath: "/path/to/t.jpg" }],
      };
      mockedUpload.mockRejectedValue(new PostError(type, "Transport outcome", { code }));

      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: type,
        message: "Transport outcome",
        details: { code },
      });
      expect(mockedUpload).toHaveBeenCalledTimes(1);
      expect(mockYouTubeClient.videos.insert).not.toHaveBeenCalled();
      expect(mockYouTubeClient.thumbnails.set).not.toHaveBeenCalled();
      expect(mockYouTubeClient.playlistItems.insert).not.toHaveBeenCalled();
    });

    it("converts an unexpected transport error into an ambiguous API error without leaking it", async () => {
      const content: Content = {
        text: "Will fail generically",
        media: [{ type: "video", path: "/path/to/video.mp4", title: "Test Video" }],
      };
      const leaky = new Error("socket hang up Bearer SECRET");
      mockedUpload.mockRejectedValue(Object.assign(leaky, { config: { headers: { Authorization: "SECRET" } } }));

      const error = await publisher.postContent(content, options).catch((error: unknown) => error);
      expect(error).toMatchObject({
        errorType: PostErrorType.API_ERROR,
        details: { stage: "upload", code: "youtube_upload_unexpected_error" },
      });
      expect((error as Error).message).toContain("check YouTube Studio before reposting");
      expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain("SECRET");
      expect(mockedUpload).toHaveBeenCalledTimes(1);
    });

    it("returns a thumbnail warning with the published video ID without retrying the upload", async () => {
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

      mockedUpload.mockResolvedValue({ videoId: "video_id_warn" });
      mockYouTubeClient.thumbnails.set.mockRejectedValue(
        new Error("Thumbnail upload failed: https://www.googleapis.com/upload?upload_id=SECRET"),
      );
      const warn = jest.spyOn(publisher.logger, "warn");

      const result = await publisher.postContent(content, options);

      expect(result).toEqual({
        id: "video_id_warn",
        error: PostErrorType.NO_ERROR,
        message: expect.stringContaining("Video published, but YouTube could not apply the custom thumbnail"),
        details: { code: "youtube_thumbnail_upload_failed", videoId: "video_id_warn" },
      });
      expect(result.message).toContain("Do not repost this video");
      expect(result.message).not.toContain("SECRET");
      expect(warn).toHaveBeenCalledWith("[YouTubePublisher] Failed to upload thumbnail for video video_id_warn");
      for (const [message] of warn.mock.calls) expect(String(message)).not.toContain("SECRET");
      expect(mockedUpload).toHaveBeenCalledTimes(1);
      expect(mockYouTubeClient.thumbnails.set).toHaveBeenCalledTimes(1);
    });

    it.each(["failed", "rejected"])(
      "reports an accepted upload whose status is %s as a warning with the ID, never as a retryable error",
      async (uploadStatus) => {
        const content: Content = {
          text: "Status warning",
          media: [{ type: "video", path: "/path/to/video.mp4", title: "Test Video" }],
        };
        mockedUpload.mockResolvedValue({ videoId: "video_id_status", uploadStatus });

        const result = await publisher.postContent(content, options);

        expect(result).toEqual({
          id: "video_id_status",
          error: PostErrorType.NO_ERROR,
          message: expect.stringContaining(`reported its status as "${uploadStatus}"`),
          details: { code: "youtube_upload_status_warning", videoId: "video_id_status" },
        });
        expect(result.message).toContain("Do not repost this video");
        expect(mockedUpload).toHaveBeenCalledTimes(1);
      },
    );

    it("treats a processing status as success without any warning", async () => {
      mockedUpload.mockResolvedValue({ videoId: "video_id_processing", uploadStatus: "processed" });
      const result = await publisher.postContent(
        { text: "Processing", media: [{ type: "video", path: "/path/to/video.mp4", title: "Test Video" }] },
        options,
      );
      expect(result).toEqual({ id: "video_id_processing", error: PostErrorType.NO_ERROR });
    });

    it("rejects disabled playlist assignment before any upload or media processing", async () => {
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

      await expect(publisher.postContent(content, optionsWithPlaylist)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        message: expect.stringContaining("playlist assignment is temporarily unavailable"),
      });
      expect(mockedUpload).not.toHaveBeenCalled();
      expect(mockYouTubeClient.playlistItems.insert).not.toHaveBeenCalled();
      expect(mockedFs.createReadStream).not.toHaveBeenCalled();
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
          privacyStatus: "public",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      };

      mockedUpload.mockResolvedValue({ videoId: "scheduled_video_123" });

      const result = await publisher.postContent(content, optionsWithSchedule);

      expect(mockedUpload).toHaveBeenCalledWith(
        expectedUpload("/path/to/video.mp4", 1024 * 1024, {
          snippet: {
            title: "Scheduled Video",
            description: "This video is scheduled",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            // Scheduling forces private until publishAt, regardless of the requested privacy.
            privacyStatus: "private",
            publishAt: "2024-12-25T12:00:00.000Z",
            selfDeclaredMadeForKids: false,
          },
        }),
      );
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

      mockedUpload.mockResolvedValue({ videoId: "regular_video_123" });

      const result = await publisher.postContent(content, optionsWithPrivacy);

      expect(mockedUpload).toHaveBeenCalledWith(
        expectedUpload("/path/to/video.mp4", 1024 * 1024, {
          snippet: {
            title: "Regular Video",
            description: "Regular video",
            tags: undefined,
            categoryId: undefined,
          },
          status: {
            privacyStatus: "public",
            publishAt: undefined,
            selfDeclaredMadeForKids: false,
          },
        }),
      );
      expect(result).toEqual({ id: "regular_video_123", error: PostErrorType.NO_ERROR });
    });
  });

  describe("validate", () => {
    const options: PostOptionsWithCredentials = {
      youtube: {
        credentials: {
          accessToken: "test_access_token",
        },
      },
    };

    beforeEach(() => {
      publisher = new YouTubePublisher(options);
    });

    it("should reject titles instead of truncating them", () => {
      const content: Content = {
        text: "a".repeat(150),
        media: [{ type: "video", path: "/path/video.mp4" }],
      };

      const result = YouTubePublisher.validate(content);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("title_too_long");
    });

    it("should error when description is too long", () => {
      const content: Content = {
        media: [
          {
            type: "video",
            path: "/path/video.mp4",
            title: "Valid title",
            description: "a".repeat(6000),
          },
        ],
      };

      const result = YouTubePublisher.validate(content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("description_too_long");
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

      mockedUpload.mockResolvedValue({ videoId: "video_id_post" });

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
        message: "YouTube content validation failed",
        details: expect.anything(),
      });
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(YouTubePublisher.prototype, "validateReadiness").mockResolvedValue([]));
