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
          // Nothing has been sent yet, so a failed download is a safe-to-retry preparation failure.
        ).rejects.toMatchObject({
          errorType: failure === "download" ? PostErrorType.PREPARATION_ERROR : PostErrorType.INVALID_CONTENT,
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

  describe("flood control", () => {
    const options: PostOptionsWithCredentials = {
      telegram: { chatId: "test_chat_id", credentials: { botToken: "test_bot_token" } },
    };
    const video: Content = { text: "Clip", media: [{ type: "video", url: "https://cdn.example.com/clip.mp4" }] };
    const flood = (retryAfter: number) => ({
      message: "Request failed with status code 429",
      response: {
        status: 429,
        headers: { "retry-after": String(retryAfter) },
        data: {
          ok: false,
          error_code: 429,
          description: `Too Many Requests: retry after ${retryAfter}`,
          parameters: { retry_after: retryAfter },
        },
      },
    });
    const sent = { data: { result: { message_id: 7 } } };

    // The URL-backed clip is resolved to a local path so no download is attempted;
    // the top-level afterEach restores the spy. Tests may override the resolved value.
    beforeEach(() => {
      jest
        .spyOn(mediaUtils, "resolveMediaPath")
        .mockResolvedValue({ path: "/tmp/clip.mp4", cleanup: async () => {}, isTemp: true });
    });

    it("classifies wrapped media-download failures before sending and strips their diagnostics", async () => {
      jest
        .spyOn(mediaUtils, "resolveMediaPath")
        .mockRejectedValueOnce(
          new PostError(PostErrorType.API_ERROR, "download failed https://secret.example/token", { token: "secret" }),
        );
      await expect(publisher.postContent(video, options)).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        message: "Failed to prepare Telegram video. Nothing was sent.",
        details: { stage: "prepare_media" },
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it("retries only the explicit flood-control rejection, waiting exactly as instructed", async () => {
      jest.useFakeTimers();
      const cleanup = jest.fn(async () => {});
      const resolve = jest
        .spyOn(mediaUtils, "resolveMediaPath")
        .mockResolvedValue({ path: "/tmp/clip.mp4", cleanup, isTemp: true });
      mockAxiosInstance.post
        .mockRejectedValueOnce(flood(5))
        .mockRejectedValueOnce(flood(2))
        .mockResolvedValueOnce(sent);
      try {
        const result = publisher.postContent(video, options);
        await jest.advanceTimersByTimeAsync(4999);
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        // The prepared file is kept for the retry and the first attempt's stream is already closed.
        expect(cleanup).not.toHaveBeenCalled();
        expect(mockStream.destroy).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
        // The 2-second hint is shorter than the second backoff step, so the utility waits 3 seconds.
        await jest.advanceTimersByTimeAsync(2999);
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        expect(await result).toEqual({ id: "7", error: PostErrorType.NO_ERROR });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
        for (const [endpoint] of mockAxiosInstance.post.mock.calls) expect(endpoint).toBe("/sendVideo");
        // Every attempt uploads a fresh multipart body from the same local file.
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(mockedFs.createReadStream).toHaveBeenCalledTimes(3);
        for (const call of mockedFs.createReadStream.mock.calls) expect(call[0]).toBe("/tmp/clip.mp4");
        expect(mockStream.destroy).toHaveBeenCalledTimes(3);
        const forms = mockAxiosInstance.post.mock.calls.map(([, form]: [string, any]) => form);
        expect(new Set(forms).size).toBe(3);
        for (const form of forms) {
          expect(form.append).toHaveBeenCalledWith("video", mockStream, { filename: "clip.mp4" });
          expect(form.append).toHaveBeenCalledWith("caption", "Clip");
        }
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("stops after two flood-control retries and reports a rate limit", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.post.mockRejectedValue(flood(1));
      try {
        const started = Date.now();
        const result = expect(publisher.postContent(video, options)).rejects.toMatchObject({
          errorType: PostErrorType.RATE_LIMIT_ERROR,
          message: expect.stringContaining("Nothing was sent"),
          details: { httpStatus: 429, error_code: 429, method: "sendVideo", retryAfter: 1 },
        });
        await jest.runAllTimersAsync();
        await result;
        expect(Date.now() - started).toBe(4000);
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
        expect(mockStream.destroy).toHaveBeenCalledTimes(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it("surfaces a long flood-control wait instead of shortening or waiting it out", async () => {
      // Real timers: waiting out the 45-second hint would exceed the test timeout.
      mockAxiosInstance.post.mockRejectedValue(flood(45));
      const started = Date.now();
      await expect(publisher.postContent(video, options)).rejects.toMatchObject({
        errorType: PostErrorType.RATE_LIMIT_ERROR,
        message: expect.stringContaining("wait 45 seconds"),
        details: { retryAfter: 45, parameters: { retry_after: 45 } },
      });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it("applies the same flood-control policy to text messages", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.post.mockRejectedValueOnce(flood(1)).mockResolvedValueOnce(sent);
      try {
        const result = publisher.postContent({ text: "Hello" }, options);
        await jest.runAllTimersAsync();
        expect(await result).toEqual({ id: "7", error: PostErrorType.NO_ERROR });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
        for (const [endpoint] of mockAxiosInstance.post.mock.calls) expect(endpoint).toBe("/sendMessage");
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([
      [{ message: "timeout of 120000ms exceeded", code: "ECONNABORTED" }, PostErrorType.API_ERROR],
      [{ message: "socket hang up", code: "ECONNRESET" }, PostErrorType.API_ERROR],
      [
        { response: { status: 500, data: { ok: false, error_code: 500, description: "Internal Server Error" } } },
        PostErrorType.API_ERROR,
      ],
      [{ response: { status: 502, data: "<html>Bad Gateway</html>" } }, PostErrorType.API_ERROR],
      // A 429 without Telegram's envelope (proxy/HTML page) is not the bot's flood-control rejection.
      [
        { response: { status: 429, headers: { "retry-after": "1" }, data: "<html>Too Many Requests</html>" } },
        PostErrorType.API_ERROR,
      ],
      [
        { response: { status: 429, data: { ok: false, error_code: 400, parameters: { retry_after: 1 } } } },
        PostErrorType.API_ERROR,
      ],
      // Telegram's own 429 without a retry hint is conclusive but is not retried automatically.
      [
        { response: { status: 429, data: { ok: false, error_code: 429, description: "Too Many Requests" } } },
        PostErrorType.RATE_LIMIT_ERROR,
      ],
    ])("never resends a video after %j", async (error, errorType) => {
      mockAxiosInstance.post.mockRejectedValue(error);
      const result = await publisher.post(video, options);
      expect(result.error).toBe(errorType);
      expect(result.message).toMatch(/^Failed to send video: /);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockStream.destroy).toHaveBeenCalledTimes(1);
    });

    it.each([
      [401, "Unauthorized", PostErrorType.CREDENTIALS_ERROR],
      [403, "Forbidden: bot was blocked by the user", PostErrorType.PUBLISH_REJECTED],
      [400, "Bad Request: chat not found", PostErrorType.PUBLISH_REJECTED],
    ])("fails fast on an explicit %i rejection", async (status, description, errorType) => {
      mockAxiosInstance.post.mockRejectedValue({
        response: { status, data: { ok: false, error_code: status, description } },
      });
      const result = await publisher.post(video, options);
      expect(result).toMatchObject({
        error: errorType,
        details: { httpStatus: status, ok: false, error_code: status, description },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it("keeps the bot token and bot URL out of errors and logs", async () => {
      const logError = jest.spyOn(publisher.logger, "error");
      const logWarn = jest.spyOn(publisher.logger, "warn");
      const logInfo = jest.spyOn(publisher.logger, "info");
      mockAxiosInstance.post.mockRejectedValue({
        message: "Request failed for https://api.telegram.org/bottest_bot_token/sendVideo",
        config: { baseURL: "https://api.telegram.org/bottest_bot_token", url: "/sendVideo" },
        request: { path: "/bottest_bot_token/sendVideo" },
        response: {
          status: 400,
          data: {
            ok: false,
            error_code: 400,
            description: "Bad Request: see https://api.telegram.org/bottest_bot_token for token test_bot_token",
          },
        },
      });
      const result = await publisher.post(video, options);
      expect(result.error).toBe(PostErrorType.PUBLISH_REJECTED);
      const everything = JSON.stringify({
        result,
        logs: [...logError.mock.calls, ...logWarn.mock.calls, ...logInfo.mock.calls],
      });
      expect(everything).not.toMatch(/test_bot_token|api\.telegram\.org|"config"|"request"/);
      expect(everything).toContain("[redacted URL]");
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
      expect(result.errors[0].code).toBe("telegram_text_too_long");
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

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(TelegramPublisher.prototype, "validateReadiness").mockResolvedValue([]));
