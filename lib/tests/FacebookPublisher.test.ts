import fs from "node:fs";

import axios from "axios";
import FormData from "form-data";

import { FacebookPublisher } from "../src/publishers/facebook";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

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
        new PostError(PostErrorType.API_ERROR, "Failed to post content: Invalid access token", apiError.response.data),
      );
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
