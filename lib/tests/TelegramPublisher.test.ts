import { TelegramPublisher } from "../src/publishers/telegram";
import { Content, Media } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import axios from "axios";
import fs from "fs";

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
    publisher = new TelegramPublisher();
  });

  describe("constructor", () => {
    it("should initialize axios client with correct bot token", () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://api.telegram.org/bottest_bot_token",
        timeout: 30000,
      });
    });

    it("should throw error if TELEGRAM_BOT_TOKEN is not provided", () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      expect(() => new TelegramPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "TELEGRAM_BOT_TOKEN environment variable is required")
      );
    });

    it("should throw error if TELEGRAM_BOT_TOKEN is empty", () => {
      process.env.TELEGRAM_BOT_TOKEN = "";
      expect(() => new TelegramPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "TELEGRAM_BOT_TOKEN environment variable is required")
      );
    });
  });

  describe("sendPhoto", () => {
    const chatId = "test_chat_id";
    const media: Media = { type: "image", path: "/path/to/image.jpg" };

    it("should send photo successfully", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 123 } },
      });

      const result = await publisher.sendPhoto(chatId, media, "Test caption", "HTML");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toBe("123");
    });

    it("should send photo without caption", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 456 } },
      });

      const result = await publisher.sendPhoto(chatId, media);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendPhoto", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toBe("456");
    });

    it("should throw error if media path is not provided", async () => {
      const mediaWithoutPath: Media = { type: "image" } as any;
      await expect(publisher.sendPhoto(chatId, mediaWithoutPath)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for photos")
      );
    });

    it("should throw error if photo file does not exist", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await expect(publisher.sendPhoto(chatId, media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Photo file not found at path: /path/to/image.jpg")
      );
    });

    it("should throw PostError when API request fails", async () => {
      const apiError = {
        response: {
          data: {
            description: "Bad Request: chat not found",
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.sendPhoto(chatId, media)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error sending photo: Bad Request: chat not found",
          apiError.response.data
        )
      );
    });

    it("should throw PostError with generic message when API error has no description", async () => {
      const genericError = new Error("Network error");
      mockAxiosInstance.post.mockRejectedValue(genericError);

      await expect(publisher.sendPhoto(chatId, media)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error sending photo: Network error", undefined)
      );
    });
  });

  describe("sendVideo", () => {
    const chatId = "test_chat_id";
    const media: Media = { type: "video", path: "/path/to/video.mp4" };

    it("should send video successfully", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 789 } },
      });

      const result = await publisher.sendVideo(chatId, media, "Test video caption", "Markdown");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendVideo", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toBe("789");
    });

    it("should send video without caption", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 101112 } },
      });

      const result = await publisher.sendVideo(chatId, media);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendVideo", expect.any(Object), {
        headers: { "content-type": "multipart/form-data" },
      });
      expect(result).toBe("101112");
    });

    it("should throw error if media path is not provided", async () => {
      const mediaWithoutPath: Media = { type: "video" } as any;
      await expect(publisher.sendVideo(chatId, mediaWithoutPath)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for videos")
      );
    });

    it("should throw error if video file does not exist", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await expect(publisher.sendVideo(chatId, media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Video file not found at path: /path/to/video.mp4")
      );
    });

    it("should throw PostError when API request fails", async () => {
      const apiError = {
        response: {
          data: {
            description: "Bad Request: video file too large",
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.sendVideo(chatId, media)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error sending video: Bad Request: video file too large",
          apiError.response.data
        )
      );
    });
  });

  describe("sendMessage", () => {
    const chatId = "test_chat_id";
    const text = "Hello, Telegram!";

    it("should send message successfully", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 131415 } },
      });

      const result = await publisher.sendMessage(chatId, text, "HTML");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMessage", {
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      });
      expect(result).toBe("131415");
    });

    it("should send message with default parse mode", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 161718 } },
      });

      const result = await publisher.sendMessage(chatId, text);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMessage", {
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      });
      expect(result).toBe("161718");
    });

    it("should send message as reply", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { message_id: 192021 } },
      });

      const result = await publisher.sendMessage(chatId, text, "Markdown", "123");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/sendMessage", {
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
        reply_to_message_id: 123,
      });
      expect(result).toBe("192021");
    });

    it("should throw PostError when API request fails", async () => {
      const apiError = {
        response: {
          data: {
            description: "Bad Request: message is too long",
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher.sendMessage(chatId, text)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error sending message: Bad Request: message is too long",
          apiError.response.data
        )
      );
    });
  });

  describe("postContent", () => {
    const chatId = "test_chat_id";

    it("should throw error if chatId is not provided", async () => {
      const content: Content = { text: "Hello!" };
      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Telegram chatId is required in content.options.telegramSpecific.chatId"
        )
      );
    });

    it("should throw error if content is empty", async () => {
      const content: Content = {
        options: {
          telegramSpecific: { chatId },
        },
      };
      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Telegram")
      );
    });

    it("should send text message", async () => {
      const sendMessageSpy = jest.spyOn(publisher, "sendMessage").mockResolvedValue("msg123");
      const content: Content = {
        text: "Hello, Telegram!",
        options: {
          telegramSpecific: { chatId, parseMode: "Markdown" },
        },
      };

      const result = await publisher.postContent(content);

      expect(sendMessageSpy).toHaveBeenCalledWith(chatId, "Hello, Telegram!", "Markdown");
      expect(result).toBe("msg123");
    });

    it("should send photo with caption", async () => {
      const sendPhotoSpy = jest.spyOn(publisher, "sendPhoto").mockResolvedValue("photo123");
      const content: Content = {
        text: "Photo caption",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
        options: {
          telegramSpecific: { chatId, parseMode: "HTML" },
        },
      };

      const result = await publisher.postContent(content);

      expect(sendPhotoSpy).toHaveBeenCalledWith(chatId, content.media![0], "Photo caption", "HTML");
      expect(result).toBe("photo123");
    });

    it("should send video with caption", async () => {
      const sendVideoSpy = jest.spyOn(publisher, "sendVideo").mockResolvedValue("video123");
      const content: Content = {
        text: "Video caption",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
        options: {
          telegramSpecific: { chatId },
        },
      };

      const result = await publisher.postContent(content);

      expect(sendVideoSpy).toHaveBeenCalledWith(chatId, content.media![0], "Video caption", undefined);
      expect(result).toBe("video123");
    });

    it("should throw error for unsupported media type", async () => {
      const content: Content = {
        text: "Unsupported media",
        media: [{ type: "audio" } as any],
        options: {
          telegramSpecific: { chatId },
        },
      };

      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Unsupported media type: audio")
      );
    });

    it("should throw error when no valid content to send", async () => {
      const content: Content = {
        media: [], // Empty media array
        options: {
          telegramSpecific: { chatId },
        },
      };

      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "No valid content to send")
      );
    });
  });

  describe("post (main entry)", () => {
    const chatId = "test_chat_id";

    it("should post a single message", async () => {
      const postContentSpy = jest.spyOn(publisher, "postContent").mockResolvedValue("msg123");
      const content: Content = {
        text: "Single message",
        options: {
          telegramSpecific: { chatId },
        },
      };

      const results = await publisher.post([content]);

      expect(postContentSpy).toHaveBeenCalledWith(content);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "msg123",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post multiple messages in sequence", async () => {
      const postContentSpy = jest
        .spyOn(publisher, "postContent")
        .mockResolvedValueOnce("msg1")
        .mockResolvedValueOnce("msg2")
        .mockResolvedValueOnce("msg3");

      const content: Content[] = [
        {
          text: "First message",
          options: { telegramSpecific: { chatId } },
        },
        {
          text: "Second message",
          options: { telegramSpecific: { chatId } },
        },
        {
          text: "Third message",
          options: { telegramSpecific: { chatId } },
        },
      ];

      const results = await publisher.post(content);

      expect(postContentSpy).toHaveBeenCalledTimes(3);
      expect(postContentSpy).toHaveBeenNthCalledWith(1, content[0]);
      expect(postContentSpy).toHaveBeenNthCalledWith(2, content[1]);
      expect(postContentSpy).toHaveBeenNthCalledWith(3, content[2]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ id: "msg1", error: PostErrorType.NO_ERROR });
      expect(results[1]).toEqual({ id: "msg2", error: PostErrorType.NO_ERROR });
      expect(results[2]).toEqual({ id: "msg3", error: PostErrorType.NO_ERROR });
    });

    it("should return error result if postContent fails with PostError", async () => {
      const error = new PostError(PostErrorType.API_ERROR, "API Error", { code: 400 });
      jest.spyOn(publisher, "postContent").mockRejectedValue(error);

      const content: Content = {
        text: "Will fail",
        options: { telegramSpecific: { chatId } },
      };

      const results = await publisher.post([content]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "API Error",
        details: { code: 400 },
      });
    });

    it("should return error result if postContent fails with other error", async () => {
      const error = new Error("Network timeout");
      jest.spyOn(publisher, "postContent").mockRejectedValue(error);

      const content: Content = {
        text: "Will fail",
        options: { telegramSpecific: { chatId } },
      };

      const results = await publisher.post([content]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.OTHER,
        message: "Error posting to Telegram: Network timeout",
        details: error,
      });
    });

    it("should handle mixed success and failure", async () => {
      const error = new PostError(PostErrorType.INVALID_CONTENT, "Invalid content");
      const postContentSpy = jest
        .spyOn(publisher, "postContent")
        .mockResolvedValueOnce("msg1")
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("msg3");

      const content: Content[] = [
        { text: "First", options: { telegramSpecific: { chatId } } },
        { text: "Second", options: { telegramSpecific: { chatId } } },
        { text: "Third", options: { telegramSpecific: { chatId } } },
      ];

      const results = await publisher.post(content);

      expect(postContentSpy).toHaveBeenCalledTimes(3);
      expect(postContentSpy).toHaveBeenNthCalledWith(1, content[0]);
      expect(postContentSpy).toHaveBeenNthCalledWith(2, content[1]);
      expect(postContentSpy).toHaveBeenNthCalledWith(3, content[2]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ id: "msg1", error: PostErrorType.NO_ERROR });
      expect(results[1]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Invalid content",
        details: undefined,
      });
      expect(results[2]).toEqual({ id: "msg3", error: PostErrorType.NO_ERROR });
    });
  });

  describe("integration with Content types", () => {
    const chatId = "test_chat_id";

    it("should handle complete Content with all telegram-specific options", async () => {
      const sendPhotoSpy = jest.spyOn(publisher, "sendPhoto").mockResolvedValue("photo123");
      const content: Content = {
        text: "Complete content test with image",
        media: [
          {
            type: "image",
            path: "/path/to/image.jpg",
          },
        ],
        options: {
          telegramSpecific: {
            chatId: chatId,
            parseMode: "MarkdownV2",
          },
        },
      };

      await publisher.post([content]);

      expect(sendPhotoSpy).toHaveBeenCalledWith(
        chatId,
        content.media![0],
        "Complete content test with image",
        "MarkdownV2"
      );
    });

    it("should handle video content with all properties", async () => {
      const sendVideoSpy = jest.spyOn(publisher, "sendVideo").mockResolvedValue("video123");
      const content: Content = {
        text: "Video with all properties",
        media: [
          {
            type: "video",
            path: "/path/to/video.mp4",
            title: "Test Video",
            description: "A test video description",
            thumbnailPath: "/path/to/thumbnail.jpg",
          },
        ],
        options: {
          telegramSpecific: {
            chatId: chatId,
            parseMode: "HTML",
          },
        },
      };

      await publisher.post([content]);

      expect(sendVideoSpy).toHaveBeenCalledWith(chatId, content.media![0], "Video with all properties", "HTML");
    });
  });
});
