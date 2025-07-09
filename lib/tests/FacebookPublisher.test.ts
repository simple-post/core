import { FacebookPublisher } from "../src/publishers/facebook";
import { Content, Media } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import axios from "axios";
import fs from "fs";

// Mock axios and fs
jest.mock("axios");
jest.mock("fs");
const mockAxios = axios as jest.Mocked<typeof axios>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe("FacebookPublisher", () => {
  let publisher: FacebookPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test_page_access_token";
    process.env.FACEBOOK_PAGE_ID = "test_page_id";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockAxios.create = jest.fn(() => mockAxiosInstance);

    // Create a new publisher instance
    publisher = new FacebookPublisher();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
  });

  describe("constructor", () => {
    it("should initialize with correct credentials", () => {
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: "https://graph.facebook.com/v23.0",
        timeout: 30000,
      });
    });

    it("should throw error when FACEBOOK_PAGE_ACCESS_TOKEN is missing", () => {
      delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required")
      );
    });

    it("should throw error when FACEBOOK_PAGE_ID is missing", () => {
      delete process.env.FACEBOOK_PAGE_ID;
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ID environment variable is required")
      );
    });
  });

  describe("validate", () => {
    it("should validate successfully with text", () => {
      const content: Content = { text: "Hello World!" };
      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should validate successfully with text and image", () => {
      const content: Content = {
        text: "Hello with image",
        media: [{ type: "image", path: "/test/image.jpg" }],
      };
      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should throw error for empty content", () => {
      const content: Content = {};
      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook")
      );
    });

    it("should validate video media successfully", () => {
      const content: Content = {
        text: "Video content",
        media: [{ type: "video", path: "/test/video.mp4" }],
      };
      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should validate multiple image media successfully", () => {
      const content: Content = {
        text: "Multiple images",
        media: [
          { type: "image", path: "/test/image1.jpg" },
          { type: "image", path: "/test/image2.jpg" },
        ],
      };
      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should throw error for too many media items", () => {
      const content: Content = {
        text: "Too many images",
        media: Array(11).fill({ type: "image", path: "/test/image.jpg" }),
      };
      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Facebook supports maximum of 10 images in a single post")
      );
    });

    it("should throw error for mixed media types in multi-media post", () => {
      const content: Content = {
        text: "Mixed media",
        media: [
          { type: "image", path: "/test/image.jpg" },
          { type: "video", path: "/test/video.mp4" },
        ],
      };
      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video posts can only contain a single video, no other media")
      );
    });

    it("should throw error for missing media path", () => {
      const content: Content = {
        text: "Media without path",
        media: [{ type: "image" }],
      };
      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media path is required")
      );
    });
  });

  describe("uploadMedia", () => {
    beforeEach(() => {
      // Mock fs readFileSync
      mockFs.readFileSync.mockReturnValue(Buffer.from("test file content"));

      // Mock Blob constructor
      global.Blob = jest.fn().mockImplementation((content) => ({
        content,
        type: "application/octet-stream",
      })) as any;

      // Mock FormData
      global.FormData = jest.fn().mockImplementation(() => ({
        append: jest.fn(),
      })) as any;
    });

    it("should upload image media", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "photo_id_123" } });

      const media: Media = { type: "image", path: "test.jpg" };
      const result = await publisher.uploadMedia(media);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/photos",
        expect.any(Object),
        expect.objectContaining({
          headers: {
            "Content-Type": "multipart/form-data",
          },
        })
      );
      expect(result).toBe("photo_id_123");
    });

    it("should upload video media with title and description", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "video_id_456" } });

      const media: Media = {
        type: "video",
        path: "test.mp4",
        title: "Test Video",
        description: "Test Description",
      };
      const result = await publisher.uploadMedia(media);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/videos",
        expect.any(Object),
        expect.objectContaining({
          headers: {
            "Content-Type": "multipart/form-data",
          },
        })
      );
      expect(result).toBe("video_id_456");
    });

    it("should throw error for unsupported media type", async () => {
      const media: Media = { type: "audio", path: "test.mp3" } as any;
      await expect(publisher.uploadMedia(media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Unsupported media type: audio")
      );
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
      mockAxiosInstance.post.mockRejectedValue(apiError);

      const media: Media = { type: "image", path: "test.jpg" };
      await expect(publisher.uploadMedia(media)).rejects.toThrow(PostError);
    });
  });

  describe("post", () => {
    it("should post successfully", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "mock_post_id" } });

      const validateSpy = jest.spyOn(publisher, "validate");
      const content: Content = { text: "Test post" };

      const result = await publisher.post(content, {});

      expect(validateSpy).toHaveBeenCalledWith(content);
      expect(result).toEqual({
        id: "mock_post_id",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should return error for validation failure", async () => {
      const content: Content = {}; // Invalid content

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported by Facebook",
        details: undefined,
      });
    });

    it("should post text-only content", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_123" } });

      const content: Content = { text: "Hello Facebook!" };
      const result = await publisher.post(content, {});

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Hello Facebook!",
      });
      expect(result).toEqual({
        id: "post_id_123",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with single image", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, "uploadMedia").mockResolvedValue("photo_id_123");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_456" } });

      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "test.jpg" }],
      };
      const result = await publisher.post(content, {});

      expect(publisher.uploadMedia).toHaveBeenCalledWith({ type: "image", path: "test.jpg" });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Check out this image!",
        object_attachment: "photo_id_123",
      });
      expect(result).toEqual({
        id: "post_id_456",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with single video", async () => {
      // Spy on uploadMedia to track if it's called
      const uploadMediaSpy = jest.spyOn(publisher, "uploadMedia");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_789" } });

      const content: Content = {
        text: "Check out this video!",
        media: [{ type: "video", path: "test.mp4" }],
      };
      const result = await publisher.post(content, {});

      // Verify uploadMedia is NOT called for single video posts
      expect(uploadMediaSpy).not.toHaveBeenCalled();
      // Verify the direct video upload to /videos endpoint
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/videos",
        expect.any(Object), // FormData object
        expect.objectContaining({
          headers: {
            "Content-Type": "multipart/form-data",
          },
        })
      );
      expect(result).toEqual({
        id: "post_id_789",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with multiple images", async () => {
      // Mock uploadMedia
      jest
        .spyOn(publisher, "uploadMedia")
        .mockResolvedValueOnce("photo_id_1")
        .mockResolvedValueOnce("photo_id_2")
        .mockResolvedValueOnce("photo_id_3");

      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_multi" } });

      const content: Content = {
        text: "Multiple images!",
        media: [
          { type: "image", path: "test1.jpg" },
          { type: "image", path: "test2.jpg" },
          { type: "image", path: "test3.jpg" },
        ],
      };
      const result = await publisher.post(content, {});

      expect(publisher.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Multiple images!",
        attached_media: JSON.stringify([
          { media_fbid: "photo_id_1" },
          { media_fbid: "photo_id_2" },
          { media_fbid: "photo_id_3" },
        ]),
      });
      expect(result).toEqual({
        id: "post_id_multi",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle API errors during posting", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Post failed",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      const content: Content = { text: "Will fail" };
      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Error posting to Facebook: Post failed",
        details: apiError.response.data,
      });
    });

    it("should return validation error if validate throws generic error", async () => {
      jest.spyOn(publisher, "validate").mockImplementation(() => {
        throw new Error("Generic validation error");
      });

      const content: Content = { text: "Will fail validation" };
      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.OTHER,
        message: "An unknown error occurred while validating Facebook post.",
      });
    });
  });

  describe("integration with Content types", () => {
    it("should return validation error for mixed media types", async () => {
      const content: Content = {
        text: "Complete content test",
        media: [
          {
            type: "image",
            path: "img1.jpg",
          },
          {
            type: "video",
            path: "vid1.mp4",
            title: "Test Video",
            description: "A test video",
            thumbnailPath: "thumb1.jpg",
          },
        ],
      };

      // This should fail due to mixed media types
      const result = await publisher.post(content, {});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Video posts can only contain a single video, no other media",
        details: undefined,
      });
    });

    it("should successfully post valid single image content", async () => {
      jest.spyOn(publisher, "uploadMedia").mockResolvedValue("photo_id_1");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_123" } });

      const content: Content = {
        text: "Single image post",
        media: [
          {
            type: "image",
            path: "img1.jpg",
          },
        ],
      };

      const result = await publisher.post(content, {});

      expect(result).toEqual({
        id: "post_id_123",
        error: PostErrorType.NO_ERROR,
      });
    });
  });
});
