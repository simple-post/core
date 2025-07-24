import fs from "node:fs";

import axios from "axios";

import { TelegramPublisher } from "../src/publishers/telegram";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptions, PostOptionsWithCredentials } from "../src/types/post";

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

describe("TelegramPublisher", () => {
  let publisher: TelegramPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.createReadStream.mockReturnValue("mock-stream" as any);

    // Create a new publisher instance
    publisher = new TelegramPublisher({
      telegram: {
        chatId: "dummy_chat_id",
        credentials: {
          botToken: "test_bot_token",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should initialize axios client with correct bot token", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://api.telegram.org/bottest_bot_token",
        timeout: 30_000,
      });
    });

    it("should throw error if TELEGRAM_BOT_TOKEN is not provided", () => {
      expect(() => new TelegramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Telegram credentials are required in options.telegram.credentials",
        ),
      );
    });

    it("should accept empty bot token", () => {
      expect(
        () => new TelegramPublisher({ telegram: { chatId: "dummy", credentials: { botToken: "" } } }),
      ).not.toThrow();
    });
  });

  describe("postContent", () => {
    const options: PostOptionsWithCredentials = {
      telegram: {
        chatId: "test_chat_id",
        parseMode: "HTML",
        credentials: {
          botToken: "test_bot_token",
        },
      },
    };

    it("should post text message successfully", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 123 } },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMessage", {
        chat_id: "test_chat_id",
        text: "Hello, world!",
        parse_mode: "HTML",
      });
      expect(result).toEqual({ id: "123", error: PostErrorType.NO_ERROR });
    });

    it("should post image with caption successfully", async () => {
      const content: Content = {
        text: "Image caption",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 456 } },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toEqual({ id: "456", error: PostErrorType.NO_ERROR });
    });

    it("should post image without caption successfully", async () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 789 } },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toEqual({ id: "789", error: PostErrorType.NO_ERROR });
    });

    it("should post video with caption successfully", async () => {
      const content: Content = {
        text: "Video caption",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 101_112 } },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendVideo", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toEqual({ id: "101112", error: PostErrorType.NO_ERROR });
    });

    it("should throw error if chatId is not provided", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      const invalidOptions: PostOptions = {};

      await expect(publisher.postContent(content, invalidOptions as PostOptionsWithCredentials)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Telegram chatId is required in options.telegram.chatId"),
      );
    });

    it("should throw error if content is empty", async () => {
      const content: Content = {};

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Telegram"),
      );
    });

    it("should throw error if media file does not exist", async () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/nonexistent.jpg" }],
      };

      mockedFs.existsSync.mockReturnValue(false);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file not found at path: /path/to/nonexistent.jpg"),
      );
    });

    it("should handle API errors gracefully", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      const apiError = {
        response: {
          data: {
            description: "Bad Request: chat not found",
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Failed to send message: Bad Request: chat not found",
          apiError.response.data,
        ),
      );
    });

    it("should handle multiple media by using only the first one", async () => {
      const content: Content = {
        text: "Multiple media",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
        ],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 131_415 } },
      });

      const result = await publisher.postContent(content, options);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toEqual({ id: "131415", error: PostErrorType.NO_ERROR });
    });

    it("should use default parse mode if not specified", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      const optionsWithoutParseMode: PostOptionsWithCredentials = {
        telegram: {
          chatId: "test_chat_id",
          credentials: {
            botToken: "test_bot_token",
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 161_718 } },
      });

      const result = await publisher.postContent(content, optionsWithoutParseMode);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMessage", {
        chat_id: "test_chat_id",
        text: "Hello, world!",
        parse_mode: "HTML",
      });
      expect(result).toEqual({ id: "161718", error: PostErrorType.NO_ERROR });
    });
  });

  describe("post", () => {
    const options: PostOptionsWithCredentials = {
      telegram: {
        chatId: "test_chat_id",
        parseMode: "HTML",
        credentials: {
          botToken: "test_bot_token",
        },
      },
    };

    it("should post content successfully and return PostResult", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 192_021 } },
      });

      const result = await publisher.post(content, options);

      expect(result).toEqual({ id: "192021", error: PostErrorType.NO_ERROR });
    });

    it("should handle errors and return PostResult with error", async () => {
      const content: Content = {
        text: "Hello, world!",
      };

      const apiError = {
        response: {
          data: {
            description: "Bad Request: chat not found",
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      const result = await publisher.post(content, options);

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Failed to send message: Bad Request: chat not found",
        details: apiError.response.data,
      });
    });

    it("should handle validation errors and return PostResult with error", async () => {
      const content: Content = {};

      const result = await publisher.post(content, options);

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported by Telegram",
        details: undefined,
      });
    });
  });
});
