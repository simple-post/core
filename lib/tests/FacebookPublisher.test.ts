import fs from "node:fs";

import axios from "axios";
import FormData from "form-data";

import { FacebookPublisher } from "../src/publishers/facebook";
import { PostError, PostErrorType } from "../src/types";

import type { Content, Media, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("form-data", () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ "content-type": "multipart/form-data" }),
  }));
});

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedFormData = FormData as jest.MockedClass<typeof FormData>;

describe("FacebookPublisher", () => {
  let publisher: FacebookPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test_access_token";
    process.env.FACEBOOK_PAGE_ID = "test_page_id";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock file content"));

    // Mock FormData
    const mockFormDataInstance = {
      append: jest.fn(),
    };
    mockedFormData.mockImplementation(() => mockFormDataInstance as any);

    // Create a new publisher instance
    publisher = new FacebookPublisher({
      facebook: {
        credentials: {
          pageAccessToken: "test_access_token",
          pageId: "test_page_id",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should initialize with valid credentials", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://graph.facebook.com/v23.0",
        timeout: 30_000,
      });
    });

    it("should throw error if FACEBOOK_PAGE_ACCESS_TOKEN is not provided", () => {
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Facebook credentials are required in options.facebook.credentials",
        ),
      );
    });

    it("should throw error if FACEBOOK_PAGE_ID is not provided", () => {
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Facebook credentials are required in options.facebook.credentials",
        ),
      );
    });
  });

  describe("validate", () => {
    it("should validate content with text", () => {
      const content: Content = {
        text: "Hello, Facebook!",
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should validate content with media", () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should throw error for empty content", () => {
      const content: Content = {};

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook"),
      );
    });

    it("should throw error for video with other media", () => {
      const content: Content = {
        media: [
          { type: "video", path: "/path/to/video.mp4" },
          { type: "image", path: "/path/to/image.jpg" },
        ],
      };

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video posts can only contain a single video, no other media"),
      );
    });

    it("should throw error for missing media file", () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/missing.jpg" }],
      };

      mockedFs.existsSync.mockReturnValue(false);

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file not found at path: /path/to/missing.jpg"),
      );
    });
  });

  describe("uploadImage", () => {
    it("should upload image successfully", async () => {
      const image: Media = { type: "image", path: "/path/to/image.jpg", caption: "Test image" };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "image_id_123" },
      });

      const result = await publisher.uploadImage(image);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/photos", expect.any(Object), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      expect(result).toBe("image_id_123");
    });

    it("should throw error when API fails", async () => {
      const image: Media = { type: "image", path: "/path/to/image.jpg" };

      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid access token",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.uploadImage(image)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error uploading image: Invalid access token", apiError.response.data),
      );
    });
  });

  describe("postVideo", () => {
    it("should post video successfully", async () => {
      const video: Media = { type: "video", path: "/path/to/video.mp4", title: "Test video" };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "video_id_123" },
      });

      const result = await publisher.postVideo(video);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/videos", expect.any(Object), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      expect(result).toEqual({ id: "video_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should handle API errors gracefully", async () => {
      const video: Media = { type: "video", path: "/path/to/video.mp4" };

      const apiError = {
        response: {
          data: {
            error: {
              message: "Video too large",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.postVideo(video)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Facebook API Error: Video too large", apiError),
      );
    });
  });

  describe("postContent", () => {
    const options: PostOptionsWithCredentials = {
      facebook: {
        credentials: {
          pageAccessToken: "test_access_token",
          pageId: "test_page_id",
        },
      },
    };

    it("should post text-only content successfully", async () => {
      const content: Content = {
        text: "Hello, Facebook!",
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "post_id_123" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_access_token",
        message: "Hello, Facebook!",
      });
      expect(result).toEqual({ id: "post_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should post single image successfully", async () => {
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      // Mock uploadImage to return an image ID
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "image_id_123" } }) // uploadImage call
        .mockResolvedValueOnce({ data: { id: "post_id_456" } }); // feed post call

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: "post_id_456", error: PostErrorType.NO_ERROR });
    });

    it("should post multiple images successfully", async () => {
      const content: Content = {
        text: "Multiple images",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "image", path: "/path/to/image3.jpg" },
        ],
      };

      // Mock uploadImage calls for each image
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "image_id_1" } })
        .mockResolvedValueOnce({ data: { id: "image_id_2" } })
        .mockResolvedValueOnce({ data: { id: "image_id_3" } })
        .mockResolvedValueOnce({ data: { id: "post_id_789" } });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(4);
      expect(result).toEqual({ id: "post_id_789", error: PostErrorType.NO_ERROR });
    });

    it("should post single video successfully", async () => {
      const content: Content = {
        text: "Check out this video!",
        media: [{ type: "video", path: "/path/to/video.mp4", title: "Test video" }],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "video_id_123" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/videos", expect.any(Object), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      expect(result).toEqual({ id: "video_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook"),
      );
    });

    it("should handle API errors gracefully", async () => {
      const content: Content = {
        text: "This will fail",
      };

      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid access token",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error posting to Facebook: Invalid access token",
          apiError.response.data,
        ),
      );
    });

    it("should schedule a text post correctly", async () => {
      const scheduledTime = new Date("2024-12-25T12:00:00Z");
      const content: Content = {
        text: "This is a scheduled post",
      };

      const optionsWithSchedule: PostOptionsWithCredentials = {
        facebook: {
          scheduledPublishTime: scheduledTime,
          credentials: {
            pageAccessToken: "test_access_token",
            pageId: "test_page_id",
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "scheduled_post_123" },
      });

      const result = await publisher.postContent(content, optionsWithSchedule);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/feed",
        expect.objectContaining({
          access_token: "test_access_token",
          message: "This is a scheduled post",
          scheduled_publish_time: "1735128000",
          published: false,
        }),
      );
      expect(result).toEqual({ id: "scheduled_post_123", error: PostErrorType.NO_ERROR });
    });

    it("should schedule a video post correctly", async () => {
      const scheduledTime = new Date("2024-12-25T12:00:00Z");
      const content: Content = {
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Scheduled Video",
          },
        ],
      };

      const optionsWithSchedule: PostOptionsWithCredentials = {
        facebook: {
          scheduledPublishTime: scheduledTime,
          credentials: {
            pageAccessToken: "test_access_token",
            pageId: "test_page_id",
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "scheduled_video_123" },
      });

      const result = await publisher.postContent(content, optionsWithSchedule);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/videos", expect.any(Object), {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      // Verify that the FormData constructor was called (indicating video upload)
      expect(mockedFormData).toHaveBeenCalled();

      expect(result).toEqual({ id: "scheduled_video_123", error: PostErrorType.NO_ERROR });
    });
  });

  describe("post", () => {
    const options: PostOptionsWithCredentials = {
      facebook: {
        credentials: {
          pageAccessToken: "test_access_token",
          pageId: "test_page_id",
        },
      },
    };

    it("should post content successfully and return PostResult", async () => {
      const content: Content = {
        text: "Hello, Facebook!",
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "post_id_123" },
      });

      const result = await publisher.post(content, options);

      expect(result).toEqual({ id: "post_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should handle errors and return PostResult with error", async () => {
      const content: Content = {};

      const result = await publisher.post(content, options);

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported by Facebook",
        details: undefined,
      });
    });
  });
});
