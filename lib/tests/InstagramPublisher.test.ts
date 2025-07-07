import { InstagramPublisher } from "../src/publishers/instagram";
import { Content } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import axios from "axios";

// Mock dependencies
jest.mock("axios");
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({
    pipe: jest.fn(),
    on: jest.fn(),
  }),
}));
jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: jest.fn().mockResolvedValue({}),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("InstagramPublisher", () => {
  let publisher: InstagramPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.INSTAGRAM_ACCESS_TOKEN = "test_access_token";
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "test_business_account_id";

    // S3 environment variables
    process.env.INSTAGRAM_S3_STORAGE_ACCESS_KEY_ID = "test_s3_access_key";
    process.env.INSTAGRAM_S3_STORAGE_SECRET_ACCESS_KEY = "test_s3_secret_key";
    process.env.INSTAGRAM_S3_STORAGE_REGION = "us-east-1";
    process.env.INSTAGRAM_S3_STORAGE_BUCKET = "test-bucket";
    process.env.INSTAGRAM_S3_STORAGE_BASE_URL = "https://test-bucket.s3.amazonaws.com";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({ data: { status_code: "FINISHED", status: "FINISHED" } }),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Create a new publisher instance
    publisher = new InstagramPublisher();
  });

  describe("constructor", () => {
    it("should initialize axios client with correct access token", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://graph.facebook.com/v23.0",
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_access_token",
        },
      });
    });

    it("should throw error if INSTAGRAM_ACCESS_TOKEN is not provided", () => {
      delete process.env.INSTAGRAM_ACCESS_TOKEN;
      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram access token is required. Set INSTAGRAM_ACCESS_TOKEN environment variable."
        )
      );
    });

    it("should throw error if INSTAGRAM_ACCESS_TOKEN is empty", () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = "";
      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram access token is required. Set INSTAGRAM_ACCESS_TOKEN environment variable."
        )
      );
    });
  });

  describe("validate", () => {
    it("should throw error for empty content", () => {
      const content: Content = {};

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video)."
        )
      );
    });

    it("should throw error when no media is provided", () => {
      const content: Content = {
        text: "Post without media",
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video)."
        )
      );
    });

    it("should throw error when image has no path", () => {
      const content: Content = {
        text: "Post with image without path",
        media: [{ type: "image" }],
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file path is required for Instagram posts.")
      );
    });

    it("should throw error when video has no path", () => {
      const content: Content = {
        text: "Post with video without path",
        media: [{ type: "video" }],
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file path is required for Instagram posts.")
      );
    });

    it("should throw error when multiple media items are provided", () => {
      const content: Content = {
        text: "Post with multiple media",
        media: Array(11).fill({ type: "image", path: "image.jpg" }),
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Instagram posts support maximum 10 media items.")
      );
    });

    it("should throw error for too long caption", () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);

      const content: Content = {
        text: "a".repeat(2201),
        media: [{ type: "image", path: "image.jpg" }],
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Instagram caption cannot exceed 2200 characters.")
      );
    });

    it("should pass validation for valid image content", () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);

      const content: Content = {
        text: "Valid image post",
        media: [{ type: "image", path: "image.jpg" }],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should pass validation for valid video content", () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);

      const content: Content = {
        text: "Valid video post",
        media: [{ type: "video", path: "video.mp4" }],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should pass validation for content without caption", () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);

      const content: Content = {
        media: [{ type: "image", path: "image.jpg" }],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });
  });

  describe("post", () => {
    beforeEach(() => {
      process.env.INSTAGRAM_ACCESS_TOKEN = "test_access_token";
      publisher = new InstagramPublisher();
    });

    it("should return validation error when content is invalid", async () => {
      const content: Content = { text: "Post without media" };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Instagram posts require at least one media item (image or video).",
        details: undefined,
      });
    });

    it("should successfully post image", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake image"));

      // Mock the media container creation and publishing
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "media_object_id" } }) // createMediaObject
        .mockResolvedValueOnce({ data: { id: "published_post_id" } }); // publishMediaContainer

      const content: Content = {
        text: "Test image post",
        media: [{ type: "image", path: "test.jpg" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "published_post_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should successfully post video", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake video"));

      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "video_object_id" } })
        .mockResolvedValueOnce({ data: { id: "published_video_id" } });

      const content: Content = {
        text: "Test video post",
        media: [{ type: "video", path: "test.mp4" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "published_video_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post without caption", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake image"));

      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "media_object_id" } })
        .mockResolvedValueOnce({ data: { id: "published_post_id" } });

      const content: Content = {
        media: [{ type: "image", path: "test.jpg" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "published_post_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle API errors during posting", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake image"));

      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid media URL",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      const content: Content = {
        text: "Will fail",
        media: [{ type: "image", path: "invalid.jpg" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Error creating Instagram media container: Error creating media object: Invalid media URL",
        details: expect.any(Object),
      });
    });

    it("should handle validation errors", async () => {
      const content: Content = {
        text: "Will fail validation - no media",
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Instagram posts require at least one media item (image or video).",
        details: undefined,
      });
    });
  });

  describe("error handling", () => {
    it("should handle network errors gracefully", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake image"));

      const networkError = new Error("ECONNRESET");
      mockAxiosInstance.post.mockRejectedValue(networkError);

      const content: Content = {
        text: "Network error test",
        media: [{ type: "image", path: "test.jpg" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe(PostErrorType.API_ERROR);
      expect(results[0].message).toContain("ECONNRESET");
    });

    it("should handle malformed API responses", async () => {
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFileSync").mockReturnValue(Buffer.from("fake image"));

      mockAxiosInstance.post.mockResolvedValue({ data: null });

      const content: Content = {
        text: "Malformed response test",
        media: [{ type: "image", path: "test.jpg" }],
      };

      const results = await publisher.post(content, {});

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe(PostErrorType.API_ERROR);
    });
  });
});
