import fs from "node:fs";

import axios from "axios";

import { TelegramPublisher } from "../src/publishers/telegram";
import { PostError, PostErrorType } from "../src/types";
import * as mediaUtils from "../src/utils/media";

import type { Content, PostOptions, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));
jest.mock("form-data", () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ "content-type": "multipart/form-data" }),
  }));
});

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockStream = { destroy: jest.fn() };

describe("TelegramPublisher", () => {
  it("blocks an existing connection to the bot itself before sending", async () => {
    const options = { telegram: { chatId: "123", credentials: { botToken: "123:test-token" } } };
    const bot = new TelegramPublisher(options);
    await expect(bot.postContent({ text: "Hello" }, options)).rejects.toMatchObject({
      errorType: PostErrorType.INVALID_CONTENT,
      message: expect.stringContaining("bots cannot post to themselves"),
    });
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });
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
    mockedFs.createReadStream.mockReturnValue(mockStream as any);
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize axios client with correct bot token", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://api.telegram.org/bottest_bot_token",
        timeout: 120_000,
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

    it("should upload prepared URL media as multipart instead of passing the URL to Telegram", async () => {
      const content: Content = {
        text: "Image caption",
        media: [
          {
            type: "image",
            url: "https://cdn.example.com/generated-image.png",
            path: "/tmp/generated-image.png",
            size: 5_506_166,
          },
        ],
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 202_608 } },
      });

      const result = await publisher.postContent(content, options);
      const formData = mockAxiosInstance.post.mock.calls[0][1];

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", formData, {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(formData.append).toHaveBeenCalledWith("photo", mockStream, {
        filename: "generated-image.png",
      });
      expect(result).toEqual({ id: "202608", error: PostErrorType.NO_ERROR });
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

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("Telegram content validation failed");
    });

    it("should throw error if media file does not exist", async () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/nonexistent.jpg" }],
      };

      mockedFs.existsSync.mockReturnValue(false);

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("Media file not found");
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

    it.each([2, 4, 7, 10])("should publish %i images as one ordered album with a single caption", async (count) => {
      const content: Content = {
        text: "<b>Project photos</b>",
        media: Array.from({ length: count }, (_, index) => ({ type: "image", path: `/photos/${index}.jpg` })),
      };
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: Array.from({ length: count }, (_, index) => ({ message_id: 100 + index })) },
      });

      const result = await publisher.postContent(content, options);
      const formData = mockAxiosInstance.post.mock.calls[0][1];

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMediaGroup", formData, {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(formData.append).toHaveBeenCalledWith("chat_id", options.telegram!.chatId);
      expect(formData.append).toHaveBeenCalledWith(
        "media",
        JSON.stringify(
          content.media!.map((_, index) => ({
            type: "photo",
            media: `attach://media_${index}`,
            ...(index === 0 ? { caption: content.text, parse_mode: "HTML" } : {}),
          })),
        ),
      );
      for (let index = 0; index < count; index++) {
        expect(mockedFs.createReadStream).toHaveBeenNthCalledWith(index + 1, `/photos/${index}.jpg`);
        expect(formData.append).toHaveBeenCalledWith(`media_${index}`, mockStream, { filename: `${index}.jpg` });
      }
      expect(result).toEqual({ id: "100", error: PostErrorType.NO_ERROR });
    });

    it.each(["image", "video"] as const)(
      "should group videos with %s media without a caption and support replies",
      async (type) => {
        mockAxiosInstance.post.mockResolvedValue({ data: { result: [{ message_id: 200 }, { message_id: 201 }] } });
        await publisher.postContent(
          {
            media: [
              { type, path: "/photos/first" },
              { type: "video", path: "/photos/second.mp4" },
            ],
          },
          { telegram: { ...options.telegram!, replyTo: "42" } },
        );
        const formData = mockAxiosInstance.post.mock.calls[0][1];
        expect(formData.append).toHaveBeenCalledWith(
          "media",
          JSON.stringify([
            { type: type === "image" ? "photo" : "video", media: "attach://media_0" },
            { type: "video", media: "attach://media_1" },
          ]),
        );
        expect(formData.append).toHaveBeenCalledWith("reply_parameters", JSON.stringify({ message_id: 42 }));
      },
    );

    it.each([undefined, "MarkdownV2"] as const)("should preserve album caption parse mode %s", async (parseMode) => {
      mockAxiosInstance.post.mockResolvedValue({ data: { result: [{ message_id: 200 }, { message_id: 201 }] } });
      await publisher.postContent(
        {
          text: "Caption",
          media: [
            { type: "image", path: "/photos/first.jpg" },
            { type: "image", path: "/photos/second.jpg" },
          ],
        },
        { telegram: { ...options.telegram!, parseMode } },
      );
      const formData = mockAxiosInstance.post.mock.calls[0][1];
      expect(formData.append).toHaveBeenCalledWith(
        "media",
        JSON.stringify([
          {
            type: "photo",
            media: "attach://media_0",
            caption: "Caption",
            ...(parseMode ? { parse_mode: parseMode } : {}),
          },
          { type: "photo", media: "attach://media_1" },
        ]),
      );
    });

    it.each([false, true])("should clean up downloaded album media after API failure=%s", async (fail) => {
      const cleanups = [jest.fn(async () => {}), jest.fn(async () => {})];
      const resolve = jest.spyOn(mediaUtils, "resolveMediaPath");
      for (const [index, cleanup] of cleanups.entries())
        resolve.mockResolvedValueOnce({ path: `/tmp/${index}`, cleanup, isTemp: true });
      if (fail) {
        mockAxiosInstance.post.mockRejectedValue({ response: { data: { description: "Bad Request: invalid media" } } });
      } else {
        mockAxiosInstance.post.mockResolvedValue({ data: { result: [{ message_id: 200 }, { message_id: 201 }] } });
      }
      const content: Content = {
        media: [
          { type: "image", url: "https://cdn.example.com/first.jpg" },
          { type: "image", url: "https://cdn.example.com/second.jpg" },
        ],
      };
      const result = await publisher.post(content, options);
      expect(result).toMatchObject(
        fail
          ? {
              error: PostErrorType.API_ERROR,
              message: "Failed to send media group: Bad Request: invalid media",
            }
          : { id: "200", error: PostErrorType.NO_ERROR },
      );
      expect(resolve).toHaveBeenNthCalledWith(1, content.media![0]);
      expect(resolve).toHaveBeenNthCalledWith(2, content.media![1]);
      const formData = mockAxiosInstance.post.mock.calls[0][1];
      expect(formData.append).toHaveBeenCalledWith("media_0", mockStream, { filename: "first.jpg" });
      expect(formData.append).toHaveBeenCalledWith("media_1", mockStream, { filename: "second.jpg" });
      for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1);
      expect(mockStream.destroy).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it.each(["missing", "oversized", "download"])(
      "should clean up and send nothing when a later album item is %s",
      async (failure) => {
        const cleanup = jest.fn(async () => {});
        const resolve = jest
          .spyOn(mediaUtils, "resolveMediaPath")
          .mockResolvedValueOnce({ path: "/tmp/first.jpg", cleanup, isTemp: true });
        if (failure === "download") {
          resolve.mockRejectedValueOnce(new Error("Download failed"));
        } else {
          resolve.mockResolvedValueOnce({ path: "/tmp/second.jpg", cleanup, isTemp: true });
          if (failure === "missing") mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
          else
            mockedFs.statSync
              .mockReturnValueOnce({ size: 1024 } as any)
              .mockReturnValueOnce({ size: 11 * 1024 * 1024 } as any);
        }
        await expect(
          publisher.postContent(
            {
              media: [
                { type: "image", url: "https://cdn.example.com/first.jpg" },
                { type: "image", url: "https://cdn.example.com/second.jpg" },
              ],
            },
            options,
          ),
        ).rejects.toMatchObject({
          errorType: failure === "download" ? PostErrorType.API_ERROR : PostErrorType.INVALID_CONTENT,
        });
        expect(cleanup).toHaveBeenCalledTimes(failure === "download" ? 1 : 2);
        expect(mockStream.destroy).toHaveBeenCalledTimes(1);
        expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      },
    );

    it("should reject more than ten items before sending anything", async () => {
      const media: Content["media"] = Array.from({ length: 11 }, () => ({ type: "image", path: "/photos/image.jpg" }));
      await expect(publisher.postContent({ media }, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockedFs.createReadStream).not.toHaveBeenCalled();
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

  describe("validate", () => {
    const options: PostOptionsWithCredentials = {
      telegram: {
        chatId: "@test_channel",
        credentials: {
          botToken: "test_bot_token",
        },
      },
    };

    beforeEach(() => {
      publisher = new TelegramPublisher(options);
    });

    it("should accept multiple media items without warnings", () => {
      const content: Content = {
        text: "Multiple media",
        media: [
          { type: "image", path: "/path/1.jpg" },
          { type: "image", path: "/path/2.jpg" },
        ],
      };

      const result = TelegramPublisher.validate(content);

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(TelegramPublisher.getValidationRules().media?.maxCount).toBe(10);
    });

    it("should error when caption is too long", () => {
      const content: Content = {
        text: "a".repeat(1100),
        media: [{ type: "image", path: "/path/1.jpg" }],
      };

      const result = TelegramPublisher.validate(content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("caption_too_long");
    });

    it("should accept URL photos above 5 MiB now that they use multipart upload", () => {
      const result = TelegramPublisher.validate({
        media: [{ type: "image", url: "https://example.com/image.png", size: 5 * 1024 * 1024 + 1 }],
      });

      expect(result.errors).toHaveLength(0);
    });

    it("should reject photos above the 10 MiB multipart limit", () => {
      const result = TelegramPublisher.validate({
        media: [{ type: "image", url: "https://example.com/image.png", size: 10 * 1024 * 1024 + 1 }],
      });

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "image_too_large",
          limit: 10 * 1024 * 1024,
          actual: 10 * 1024 * 1024 + 1,
        }),
      );
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
        message: "Telegram content validation failed",
        details: expect.anything(),
      });
    });
  });
});
