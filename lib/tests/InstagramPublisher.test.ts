import fs from "node:fs";

import axios from "axios";

import { InstagramPublisher } from "../src/publishers/instagram";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("InstagramPublisher", () => {
  let publisher: InstagramPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables
    process.env.INSTAGRAM_ACCESS_TOKEN = "test_access_token";
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "test_business_account_id";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);

    // Create a new publisher instance
    publisher = new InstagramPublisher({
      instagram: {
        credentials: {
          accessToken: "test_access_token",
          businessAccountId: "test_business_account_id",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should initialize with valid credentials", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://graph.facebook.com/v23.0",
        timeout: 30_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_access_token",
        },
      });
    });

    it("should throw error if INSTAGRAM_ACCESS_TOKEN is not provided", () => {
      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram credentials are required in options.instagram.credentials",
        ),
      );
    });

    it("should throw error if INSTAGRAM_BUSINESS_ACCOUNT_ID is not provided", () => {
      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram credentials are required in options.instagram.credentials",
        ),
      );
    });
  });

  describe("validate", () => {
    it("should validate content with single image", () => {
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should validate content with multiple images", () => {
      const content: Content = {
        text: "Multiple images",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "image", path: "/path/to/image3.jpg" },
        ],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should validate content with video", () => {
      const content: Content = {
        text: "Check out this video!",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
      };

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should throw error for content without media", () => {
      const content: Content = {
        text: "Text only post",
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video).",
        ),
      );
    });

    it("should throw error for content with empty media array", () => {
      const content: Content = {
        text: "Empty media array",
        media: [],
      };

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video).",
        ),
      );
    });

    it("should throw error for missing media file", () => {
      const content: Content = {
        text: "Missing file",
        media: [{ type: "image", path: "/path/to/missing.jpg" }],
      };

      mockedFs.existsSync.mockReturnValue(false);

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file not found at path: /path/to/missing.jpg"),
      );
    });
  });

  describe("postContent", () => {
    const options: PostOptionsWithCredentials = {
      instagram: {
        credentials: {
          accessToken: "test_access_token",
          businessAccountId: "test_business_account_id",
        },
      },
    };

    it("should post single image successfully", async () => {
      const content: Content = {
        text: "Single image post",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/media1.jpg");

      // Mock media container creation
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container_id_123" } }) // createMediaObject
        .mockResolvedValueOnce({ data: { id: "post_id_456" } }); // publishMediaContainer

      // Mock waitForMediaReady
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "FINISHED" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockS3Uploader.uploadFile).toHaveBeenCalledWith("/path/to/image.jpg", expect.any(String));
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        expect.objectContaining({
          image_url: "https://s3.example.com/media1.jpg",
          caption: "Single image post",
          is_carousel_item: false,
        }),
      );
      expect(result).toEqual({ id: "post_id_456", error: PostErrorType.NO_ERROR });
    });

    it("should post single video successfully", async () => {
      const content: Content = {
        text: "Single video post",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/video1.mp4");

      // Mock media container creation
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container_id_789" } }) // createMediaObject
        .mockResolvedValueOnce({ data: { id: "post_id_012" } }); // publishMediaContainer

      // Mock waitForMediaReady
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "FINISHED" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockS3Uploader.uploadFile).toHaveBeenCalledWith("/path/to/video.mp4", expect.any(String));
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        expect.objectContaining({
          media_type: "REELS",
          video_url: "https://s3.example.com/video1.mp4",
          caption: "Single video post",
          is_carousel_item: false,
        }),
      );
      expect(result).toEqual({ id: "post_id_012", error: PostErrorType.NO_ERROR });
    });

    it("should post carousel with multiple images successfully", async () => {
      const content: Content = {
        text: "Carousel post",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
        ],
      };

      // Mock S3 uploads
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock)
        .mockResolvedValueOnce("https://s3.example.com/media1.jpg")
        .mockResolvedValueOnce("https://s3.example.com/media2.jpg");

      // Mock media container creation
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "item1_id" } }) // createMediaObject for first image
        .mockResolvedValueOnce({ data: { id: "item2_id" } }) // createMediaObject for second image
        .mockResolvedValueOnce({ data: { id: "carousel_id" } }) // createMediaContainer for carousel
        .mockResolvedValueOnce({ data: { id: "post_id_345" } }); // publishMediaContainer

      // Mock waitForMediaReady
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "FINISHED" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockS3Uploader.uploadFile).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        expect.objectContaining({
          media_type: "CAROUSEL",
          caption: "Carousel post",
          children: "item1_id,item2_id",
        }),
      );
      expect(result).toEqual({ id: "post_id_345", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for content without media", async () => {
      const content: Content = {
        text: "Text only post",
      };

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video).",
        ),
      );
    });

    it("should handle API errors during media creation", async () => {
      const content: Content = {
        text: "Will fail",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/media1.jpg");

      // Mock API error
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

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Failed to create media object: undefined", apiError),
      );
    });

    it("should handle media container status errors", async () => {
      const content: Content = {
        text: "Status error",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/media1.jpg");

      // Mock media container creation
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "container_id_error" } });

      // Mock waitForMediaReady with error status
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "ERROR", status: "Media processing failed" },
      });

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Instagram media container container_id_error creation failed: Media processing failed",
        ),
      );
    });

    it("should cleanup S3 files after posting", async () => {
      const content: Content = {
        text: "Cleanup test",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/media1.jpg");

      // Mock media container creation
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container_id_cleanup" } })
        .mockResolvedValueOnce({ data: { id: "post_id_cleanup" } });

      // Mock waitForMediaReady
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "FINISHED" },
      });

      await publisher.postContent(content, options);

      // Verify cleanup was called
      expect(mockS3Uploader.deleteFile).toHaveBeenCalled();
    });
  });

  describe("post", () => {
    const options: PostOptionsWithCredentials = {
      instagram: {
        credentials: {
          accessToken: "test_access_token",
          businessAccountId: "test_business_account_id",
        },
      },
    };

    it("should post content successfully and return PostResult", async () => {
      const content: Content = {
        text: "Test post",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock S3 upload
      const mockS3Uploader = publisher["s3MediaUploader"];
      (mockS3Uploader.uploadFile as jest.Mock).mockResolvedValue("https://s3.example.com/media1.jpg");

      // Mock media container creation
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container_id_test" } })
        .mockResolvedValueOnce({ data: { id: "post_id_test" } });

      // Mock waitForMediaReady
      mockAxiosInstance.get.mockResolvedValue({
        data: { status_code: "FINISHED" },
      });

      const result = await publisher.post(content, options);

      expect(result).toEqual({ id: "post_id_test", error: PostErrorType.NO_ERROR });
    });

    it("should handle errors and return PostResult with error", async () => {
      const content: Content = {
        text: "Text only post",
      };

      const result = await publisher.post(content, options);

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Instagram posts require at least one media item (image or video).",
        details: undefined,
      });
    });
  });
});
