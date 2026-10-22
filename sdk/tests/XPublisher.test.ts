import fs from "node:fs";

import axios from "axios";
import { TwitterApi } from "twitter-api-v2";

import { XPublisher } from "../src/publishers/x";
import { X_MAX_IMAGE_SIZE_BYTES } from "../src/publishers/x/validation";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("twitter-api-v2");
jest.mock("fs");
jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

const futureTimestamp = (): number => Math.floor(Date.now() / 1000) + 7200;
const nearExpiredTimestamp = (): number => Math.floor(Date.now() / 1000) + 30;

const validCredentialsOptions = (): PostOptionsWithCredentials => ({
  x: {
    credentials: {
      clientId: "test_client_id",
      clientSecret: "test_client_secret",
      accessToken: "test_access_token",
      refreshToken: "test_refresh_token",
      expiresAt: futureTimestamp(),
      username: "simplepost",
    },
  },
});

describe("XPublisher", () => {
  let publisher: XPublisher;
  let mockTwitterClient: any;
  let mockV2Client: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock-file-content"));

    mockV2Client = {
      get: jest.fn(),
      post: jest.fn(),
      tweet: jest.fn(),
      uploadMedia: jest.fn(),
    };

    mockTwitterClient = {
      v1: {},
      v2: mockV2Client,
    };

    MockedTwitterApi.mockImplementation(() => mockTwitterClient);
  });

  describe("constructor", () => {
    it("should throw when no credentials are provided", () => {
      expect(() => new XPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials"),
      );
    });

    it("should throw when neither accessToken nor (clientId + refreshToken) is provided", () => {
      expect(
        () =>
          new XPublisher({
            x: { credentials: { clientId: "only_client_id" } },
          }),
      ).toThrow(PostError);
    });

    it("should initialize with a cached access token", () => {
      new XPublisher(validCredentialsOptions());
      expect(MockedTwitterApi).toHaveBeenCalledWith("test_access_token");
    });

    it("should initialize with refresh-only credentials (no cached access token)", () => {
      new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            refreshToken: "test_refresh_token",
          },
        },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("");
    });
  });

  describe("postContent", () => {
    let options: PostOptionsWithCredentials;

    beforeEach(() => {
      options = validCredentialsOptions();
      publisher = new XPublisher(options);
    });

    it("should post text-only content successfully", async () => {
      const content: Content = { text: "Hello, X!" };
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_123" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("Hello, X!", {
        media: undefined,
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_123", error: PostErrorType.NO_ERROR });
    });

    it("rejects repeated cashtags before contacting X", async () => {
      await expect(publisher.postContent({ text: "$TOOF is live. Just $TOOF." }, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        details: { errors: [expect.objectContaining({ code: "too_many_cashtags" })] },
      });
      expect(mockV2Client.tweet).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("reports provider cashtag rejections without blaming account authorization or Premium", async () => {
      mockV2Client.tweet.mockRejectedValue({ code: 403, data: { detail: "Posts are limited to one cashtag." } });
      await expect(publisher.postContent({ text: "A post" }, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        message: expect.stringContaining("one cashtag"),
        details: { code: "too_many_cashtags" },
      });
    });

    it("should post content with media successfully", async () => {
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };
      mockV2Client.uploadMedia.mockResolvedValue("media_id_123");
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_456" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.uploadMedia).toHaveBeenCalledWith(expect.any(Buffer), { media_type: "image/jpeg" });
      expect(mockV2Client.post).not.toHaveBeenCalled();
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Check out this image!", {
        media: { media_ids: ["media_id_123"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_456", error: PostErrorType.NO_ERROR });
    });

    it("keeps polling video processing when X omits check_after_secs", async () => {
      jest.useFakeTimers();
      try {
        const content: Content = {
          text: "Video is ready only after processing",
          media: [{ type: "video", path: "/path/to/video.mp4" }],
        };
        mockV2Client.post.mockResolvedValue({ data: { id: "video_media_id" } });
        mockV2Client.get
          .mockResolvedValueOnce({ data: { processing_info: { state: "in_progress" } } })
          .mockResolvedValueOnce({ data: { processing_info: { state: "succeeded" } } });
        mockV2Client.tweet.mockResolvedValue({ data: { id: "video_tweet_id" } });

        const resultPromise = publisher.postContent(content, options);
        await jest.advanceTimersByTimeAsync(1000);

        await expect(resultPromise).resolves.toEqual({ id: "video_tweet_id", error: PostErrorType.NO_ERROR });
        expect(mockV2Client.uploadMedia).not.toHaveBeenCalled();
        expect(mockV2Client.get).toHaveBeenCalledTimes(2);
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    describe("bounded media preparation recovery", () => {
      const video: Content = { text: "Video", media: [{ type: "video", path: "/path/to/video.mp4" }] };
      const succeeded = { data: { processing_info: { state: "succeeded" } } };
      const CHUNK = 1024 * 1024;
      type PostCall = [string, { segment_index?: number; media?: Buffer } | undefined, { timeout?: number }];
      const postCalls = (suffix: string): PostCall[] =>
        mockV2Client.post.mock.calls.filter(([url]: PostCall) => url.endsWith(suffix));

      beforeEach(() => {
        jest.useFakeTimers();
        mockV2Client.post.mockResolvedValue({ data: { id: "video_media_id" } });
        mockV2Client.get.mockResolvedValue(succeeded);
        mockV2Client.tweet.mockResolvedValue({ data: { id: "video_tweet_id" } });
      });
      afterEach(() => jest.useRealTimers());

      it.each(["", "https://secret.example/token", "x".repeat(201)])(
        "rejects an invalid media ID before uploading chunks: %s",
        async (id) => {
          mockV2Client.post.mockResolvedValueOnce({ data: { id } });
          const error = await publisher.postContent(video, options).catch((error_: unknown) => error_);
          expect(error).toMatchObject({ errorType: PostErrorType.PREPARATION_ERROR });
          expect(mockV2Client.post).toHaveBeenCalledTimes(1);
          expect(mockV2Client.tweet).not.toHaveBeenCalled();
          expect(JSON.stringify(error)).not.toContain("secret.example");
        },
      );

      it("uploads a video with bounded initialize, append and finalize requests before a single tweet", async () => {
        const file = Buffer.concat([Buffer.alloc(CHUNK, 1), Buffer.alloc(10, 2)]);
        mockedFs.readFileSync.mockReturnValue(file);

        await expect(publisher.postContent(video, options)).resolves.toEqual({
          id: "video_tweet_id",
          error: PostErrorType.NO_ERROR,
        });

        expect(mockV2Client.uploadMedia).not.toHaveBeenCalled();
        expect(mockV2Client.post.mock.calls).toEqual([
          [
            "media/upload/initialize",
            { total_bytes: file.length, media_type: "video/mp4", media_category: "tweet_video" },
            { timeout: 30_000 },
          ],
          [
            "media/upload/video_media_id/append",
            { segment_index: 0, media: expect.any(Buffer) },
            { forceBodyMode: "form-data", timeout: 120_000 },
          ],
          [
            "media/upload/video_media_id/append",
            { segment_index: 1, media: expect.any(Buffer) },
            { forceBodyMode: "form-data", timeout: 120_000 },
          ],
          ["media/upload/video_media_id/finalize", undefined, { timeout: 30_000 }],
        ]);
        const chunks = postCalls("/append").map(([, body]) => body!.media!);
        expect(chunks.map((chunk) => chunk.length)).toEqual([CHUNK, 10]);
        expect(Buffer.concat(chunks).equals(file)).toBe(true);
        expect(mockV2Client.get).toHaveBeenCalledWith(
          "media/upload",
          { command: "STATUS", media_id: "video_media_id" },
          { timeout: 30_000 },
        );
        expect(mockV2Client.tweet).toHaveBeenCalledWith("Video", {
          media: { media_ids: ["video_media_id"] },
          reply: undefined,
        });
      });

      it("uploads an animated GIF through the bounded path with the GIF category", async () => {
        const gif: Content = { text: "GIF", media: [{ type: "image", path: "/path/to/anim.gif" }] };
        mockV2Client.post.mockResolvedValue({ data: { id: "gif_media_id" } });

        await expect(publisher.postContent(gif, options)).resolves.toEqual({
          id: "video_tweet_id",
          error: PostErrorType.NO_ERROR,
        });

        expect(mockV2Client.uploadMedia).not.toHaveBeenCalled();
        expect(postCalls("initialize")[0][1]).toEqual({
          total_bytes: 17,
          media_type: "image/gif",
          media_category: "tweet_gif",
        });
        expect(postCalls("/finalize").map(([url]) => url)).toEqual(["media/upload/gif_media_id/finalize"]);
        expect(mockV2Client.get.mock.calls.map((call: unknown[]) => call[1])).toEqual([
          { command: "STATUS", media_id: "gif_media_id" },
        ]);
        expect(mockV2Client.tweet.mock.calls[0][1].media).toEqual({ media_ids: ["gif_media_id"] });
      });

      it("retries a transient upload failure and publishes exactly once", async () => {
        mockV2Client.post.mockRejectedValueOnce({ code: 503, data: { detail: "Service Unavailable" } });

        const result = publisher.postContent(video, options);
        await jest.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toEqual({ id: "video_tweet_id", error: PostErrorType.NO_ERROR });
        expect(postCalls("initialize")).toHaveLength(2);
        expect(postCalls("/finalize")).toHaveLength(1);
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
      });

      it("restarts the whole upload after a mid-chunk transport failure and publishes once", async () => {
        mockedFs.readFileSync.mockReturnValue(Buffer.alloc(2 * CHUNK + 1));
        let failed = false;
        mockV2Client.post.mockImplementation(async (url: string, body?: { segment_index?: number }) => {
          if (url === "media/upload/initialize") return { data: { id: failed ? "media_b" : "media_a" } };
          if (body?.segment_index === 1 && !failed) {
            failed = true;
            throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
          }
          return { data: {} };
        });

        const result = publisher.postContent(video, options);
        await jest.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toEqual({ id: "video_tweet_id", error: PostErrorType.NO_ERROR });
        expect(postCalls("/append").map(([url, body]) => [url, body!.segment_index])).toEqual([
          ["media/upload/media_a/append", 0],
          ["media/upload/media_a/append", 1],
          ["media/upload/media_b/append", 0],
          ["media/upload/media_b/append", 1],
          ["media/upload/media_b/append", 2],
        ]);
        expect(postCalls("/finalize").map(([url]) => url)).toEqual(["media/upload/media_b/finalize"]);
        expect(mockV2Client.get.mock.calls.map((call: unknown[]) => call[1])).toEqual([
          { command: "STATUS", media_id: "media_b" },
        ]);
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
        expect(mockV2Client.tweet.mock.calls[0][1].media).toEqual({ media_ids: ["media_b"] });
      });

      it("waits for a short rate-limit reset before repeating the upload", async () => {
        // Align the clock to a whole second so the reset timestamp maps to exactly five seconds.
        jest.setSystemTime(Math.ceil(Date.now() / 1000) * 1000);
        mockV2Client.post.mockRejectedValueOnce({
          code: 429,
          headers: { "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 5) },
        });

        const result = publisher.postContent(video, options);
        await jest.advanceTimersByTimeAsync(4999);
        expect(mockV2Client.post).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toEqual({ id: "video_tweet_id", error: PostErrorType.NO_ERROR });
        expect(postCalls("initialize")).toHaveLength(2);
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
      });

      it("stops after the bounded attempts without publishing or leaking provider details", async () => {
        mockV2Client.post.mockRejectedValue({
          code: 503,
          data: { detail: "Service Unavailable at https://upload.x.com/?token=test_access_token" },
        });

        const outcome = publisher.postContent(video, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(4000);

        const error = (await outcome) as PostError;
        expect(error).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: "Failed to upload media to X. Retry the post.",
          details: expect.objectContaining({ code: "media_upload_failed", httpStatus: 503 }),
        });
        const surfaced = `${error.message} ${JSON.stringify(error.details)}`;
        expect(surfaced).not.toContain("test_access_token");
        expect(surfaced).not.toContain("https://");
        expect(surfaced).not.toContain("Service Unavailable");
        await jest.advanceTimersByTimeAsync(60_000);
        expect(mockV2Client.post.mock.calls.map(([url]: PostCall) => url)).toEqual([
          "media/upload/initialize",
          "media/upload/initialize",
          "media/upload/initialize",
        ]);
        expect(mockV2Client.get).not.toHaveBeenCalled();
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it.each([
        [
          "an expired credential",
          () => ({ code: 401, data: { detail: "Unauthorized" } }),
          PostErrorType.CREDENTIALS_ERROR,
          "media_upload_failed",
        ],
        [
          "a rate limit that resets after the retry window",
          () => ({ code: 429, headers: { "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900) } }),
          PostErrorType.RATE_LIMIT_ERROR,
          "media_upload_failed",
        ],
        [
          "a monthly usage cap reported by title",
          () => ({
            code: 429,
            data: {
              title: "UsageCapExceeded",
              detail: "Usage cap exceeded: Monthly product cap",
              type: "https://api.twitter.com/2/problems/usage-capped",
            },
          }),
          PostErrorType.RATE_LIMIT_ERROR,
          "usage_cap_exceeded",
        ],
        [
          "a monthly usage cap reported by problem type only",
          () => ({ code: 429, data: { title: "Too Many Requests", type: "about:blank/usage-capped" } }),
          PostErrorType.RATE_LIMIT_ERROR,
          "usage_cap_exceeded",
        ],
      ])("does not loop on %s", async (_label, rejection, errorType, code) => {
        const error = rejection();
        mockV2Client.post.mockRejectedValue(error);

        const outcome = publisher.postContent(video, options).catch((error_: unknown) => error_);
        await jest.advanceTimersByTimeAsync(60_000);

        expect(await outcome).toMatchObject({
          errorType,
          details: expect.objectContaining({ code, httpStatus: error.code }),
        });
        expect(mockV2Client.post).toHaveBeenCalledTimes(1);
        expect(mockV2Client.get).not.toHaveBeenCalled();
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it("maps the dependency's terminal image processing error without retrying", async () => {
        const image: Content = { text: "Image", media: [{ type: "image", path: "/path/to/image.png" }] };
        mockV2Client.uploadMedia.mockRejectedValue(new Error("Media processing failed: Unsupported codec"));

        const outcome = publisher.postContent(image, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(4000);

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.INVALID_CONTENT,
          details: expect.objectContaining({ code: "media_processing_failed" }),
        });
        expect(mockV2Client.uploadMedia).toHaveBeenCalledTimes(1);
        expect(mockV2Client.post).not.toHaveBeenCalled();
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it("bounds every upload request by the remaining deadline and stops once it is spent", async () => {
        mockedFs.readFileSync.mockReturnValue(Buffer.alloc(CHUNK + 1));
        mockV2Client.post.mockImplementation(async (url: string) => {
          // Slow responses: the clock moves while each request is in flight.
          jest.setSystemTime(Date.now() + (url === "media/upload/initialize" ? 599_000 : 2000));
          return { data: { id: "video_media_id" } };
        });

        const outcome = publisher.postContent(video, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(60_000);

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          details: expect.objectContaining({ code: "media_upload_timeout" }),
        });
        expect(mockV2Client.post.mock.calls.map(([url, , args]: PostCall) => [url, args.timeout])).toEqual([
          ["media/upload/initialize", 30_000],
          ["media/upload/video_media_id/append", 1000],
        ]);
        expect(mockV2Client.get).not.toHaveBeenCalled();
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it("retries a transient status read with the same media ID and honors check_after_secs", async () => {
        mockV2Client.get
          .mockRejectedValueOnce({ code: 502, data: { detail: "Bad Gateway" } })
          .mockResolvedValueOnce({ data: { processing_info: { state: "pending", check_after_secs: 5 } } })
          .mockResolvedValueOnce(succeeded);

        const result = publisher.postContent(video, options);
        await jest.advanceTimersByTimeAsync(1000);
        expect(mockV2Client.get).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(4999);
        expect(mockV2Client.get).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toEqual({ id: "video_tweet_id", error: PostErrorType.NO_ERROR });
        expect(mockV2Client.get).toHaveBeenCalledTimes(3);
        for (const call of mockV2Client.get.mock.calls) {
          expect(call[1]).toEqual({ command: "STATUS", media_id: "video_media_id" });
        }
        expect(postCalls("initialize")).toHaveLength(1);
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
      });

      it("bounds status reads and never publishes or re-uploads when processing stays unconfirmed", async () => {
        mockV2Client.get.mockRejectedValue({ code: 503, data: { detail: "Service Unavailable" } });

        const outcome = publisher.postContent(video, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(4000);

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          details: expect.objectContaining({ code: "media_status_unavailable", mediaId: "video_media_id" }),
        });
        expect(mockV2Client.get).toHaveBeenCalledTimes(3);
        expect(postCalls("initialize")).toHaveLength(1);
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it("stops polling at the deadline with no extra request when X asks for a longer wait", async () => {
        const longWait = { data: { processing_info: { state: "pending", check_after_secs: 3600 } } };
        mockV2Client.get.mockResolvedValue(longWait);

        const outcome = publisher.postContent(video, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(10 * 60_000 - 1);
        expect(mockV2Client.get).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          details: expect.objectContaining({ code: "media_processing_timeout", mediaId: "video_media_id" }),
        });
        await jest.advanceTimersByTimeAsync(60 * 60_000);
        expect(mockV2Client.get).toHaveBeenCalledTimes(1);
        expect(postCalls("initialize")).toHaveLength(1);
        expect(mockV2Client.tweet).not.toHaveBeenCalled();
      });

      it("never resubmits the tweet or the upload after an ambiguous publish timeout", async () => {
        mockV2Client.tweet.mockRejectedValue(Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" }));

        const outcome = publisher.postContent(video, options).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(10 * 60_000);

        expect(await outcome).toMatchObject({ errorType: PostErrorType.API_ERROR });
        expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
        expect(postCalls("initialize")).toHaveLength(1);
      });
    });

    it("fails safely before posting when X media processing fails", async () => {
      const content: Content = {
        text: "Broken video",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
      };
      mockV2Client.post.mockResolvedValue({ data: { id: "broken_media_id" } });
      mockV2Client.get.mockResolvedValue({
        data: { processing_info: { state: "failed", error: { message: "Unsupported codec" } } },
      });

      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        message: "X could not process the uploaded media. Check the file before publishing again.",
        details: expect.objectContaining({ code: "media_processing_failed" }),
      });
      // A terminal processing failure is conclusive: one status read, and the single
      // initialize/append/finalize sequence is never repeated.
      expect(mockV2Client.get).toHaveBeenCalledTimes(1);
      expect(mockV2Client.post).toHaveBeenCalledTimes(3);
      expect(mockV2Client.tweet).not.toHaveBeenCalled();
    });

    it("should post content with reply successfully", async () => {
      const content: Content = { text: "This is a reply" };
      const replyOptions: PostOptionsWithCredentials = {
        x: {
          replyToId: "original_tweet_id",
          credentials: validCredentialsOptions().x!.credentials,
        },
      };
      mockV2Client.tweet.mockResolvedValue({ data: { id: "reply_tweet_id_789" } });

      const result = await publisher.postContent(content, replyOptions);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("This is a reply", {
        media: undefined,
        reply: { in_reply_to_tweet_id: "original_tweet_id" },
      });
      expect(result).toEqual({ id: "reply_tweet_id_789", error: PostErrorType.NO_ERROR });
    });

    it("should handle multiple media files", async () => {
      const content: Content = {
        text: "Multiple images",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "image", path: "/path/to/image3.jpg" },
        ],
      };
      mockV2Client.uploadMedia
        .mockResolvedValueOnce("media_id_1")
        .mockResolvedValueOnce("media_id_2")
        .mockResolvedValueOnce("media_id_3");
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_multi" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Multiple images", {
        media: { media_ids: ["media_id_1", "media_id_2", "media_id_3"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_multi", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};
      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("X content validation failed");
    });

    it("should handle API errors during posting", async () => {
      const content: Content = { text: "This will fail" };
      mockV2Client.tweet.mockRejectedValue(new Error("API Error"));

      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
        message: "Failed to post content: Error: API Error",
        details: { platform: "x", accountHandle: "@simplepost", provider: undefined },
      });
    });

    it("blocks a long post only when X definitively reports no Premium subscription", async () => {
      const content: Content = { text: "a".repeat(455) };
      mockedAxios.get.mockResolvedValue({
        data: { data: { id: "x-user-1", username: "livehandle", subscription_type: "None" } },
      });

      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        message:
          "@livehandle does not have X Premium, so it cannot publish this post. X counts it as 455 characters. Shorten it to 280 weighted characters or split it into a thread.",
        details: {
          platform: "x",
          accountHandle: "@livehandle",
          subscriptionType: "None",
          code: "long_post_requires_premium",
          limit: 280,
          actual: 455,
        },
      });
      expect(mockV2Client.tweet).not.toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledWith("https://api.x.com/2/users/me", {
        timeout: 30_000,
        headers: { Authorization: "Bearer test_access_token" },
        params: { "user.fields": "username,subscription_type" },
      });
    });

    it.each(["Basic", "Premium", "PremiumPlus"])("allows a long post for X %s", async (subscriptionType) => {
      const content: Content = { text: "a".repeat(455) };
      mockedAxios.get.mockResolvedValue({
        data: { data: { id: "x-user-1", username: "livehandle", subscription_type: subscriptionType } },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "long-post-id" } });

      await expect(publisher.postContent(content, options)).resolves.toMatchObject({
        id: "long-post-id",
        error: PostErrorType.NO_ERROR,
      });
      expect(mockV2Client.tweet).toHaveBeenCalled();
    });

    it("attempts a long post when X Premium status cannot be determined", async () => {
      const content: Content = { text: "a".repeat(455) };
      mockedAxios.get.mockRejectedValue(new Error("User lookup unavailable"));
      mockV2Client.tweet.mockResolvedValue({ data: { id: "long-post-id" } });

      await expect(publisher.postContent(content, options)).resolves.toMatchObject({
        id: "long-post-id",
        error: PostErrorType.NO_ERROR,
      });
      expect(mockV2Client.tweet).toHaveBeenCalled();
    });

    it("blocks Japanese text over the weighted limit before publishing to a non-Premium account", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { data: { id: "x-user-1", subscription_type: "None" } },
      });
      await expect(publisher.postContent({ text: "日".repeat(141) }, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        details: { code: "long_post_requires_premium", actual: 282, limit: 280 },
      });
      expect(mockV2Client.tweet).not.toHaveBeenCalled();
      expect(mockV2Client.uploadMedia).not.toHaveBeenCalled();
    });

    it.each([
      [400, PostErrorType.PUBLISH_REJECTED],
      [401, PostErrorType.CREDENTIALS_ERROR],
      [403, PostErrorType.PUBLISH_REJECTED],
      [422, PostErrorType.PUBLISH_REJECTED],
      [429, PostErrorType.RATE_LIMIT_ERROR],
      [500, PostErrorType.API_ERROR],
      [503, PostErrorType.API_ERROR],
    ])(
      "classifies X HTTP %s without turning conclusive rejection into an unknown outcome",
      async (status, errorType) => {
        mockV2Client.tweet.mockRejectedValue({ code: status, data: { status, detail: "Rejected" } });
        await expect(publisher.postContent({ text: "Hello" }, options)).rejects.toMatchObject({ errorType });
      },
    );

    it("explains X reply restrictions without retrying or dropping the reply target", async () => {
      mockV2Client.tweet.mockRejectedValue({
        code: 403,
        data: {
          detail: "You can only reply to or quote posts where you are mentioned or are the author.",
          status: 403,
        },
      });
      await expect(
        publisher.postContent(
          { text: "Reply" },
          { x: { credentials: validCredentialsOptions().x!.credentials, replyToId: "source" } },
        ),
      ).rejects.toMatchObject({
        errorType: PostErrorType.PUBLISH_REJECTED,
        message: expect.stringContaining("Retrying the same target will not resolve this restriction"),
      });
      expect(mockV2Client.tweet).toHaveBeenCalledTimes(1);
      expect(mockV2Client.tweet.mock.calls[0][1].reply).toEqual({ in_reply_to_tweet_id: "source" });
    });

    it("uses weighted length when explaining a long-post 403", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Unavailable"));
      mockV2Client.tweet.mockRejectedValue({ code: 403, data: { status: 403, detail: "Forbidden" } });
      await expect(publisher.postContent({ text: "日".repeat(141) }, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        details: { code: "long_post_not_permitted", actual: 282 },
      });
    });

    it("should explain when X rejects a long post without long-post access", async () => {
      const content: Content = { text: "a".repeat(455) };
      mockedAxios.get.mockResolvedValue({
        data: { data: { id: "x-user-1", username: "livehandle", subscription_type: "Premium" } },
      });
      mockV2Client.tweet.mockRejectedValue(
        Object.assign(new Error("Request failed with code 403"), {
          code: 403,
          data: { detail: "You are not permitted to perform this action.", status: 403 },
        }),
      );

      await expect(publisher.postContent(content, options)).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        message:
          "X rejected this post for @livehandle (455 weighted characters). X reports the account's subscription as Premium, but did not grant long-post access for this request. Shorten it to 280 weighted characters or split it into a thread.",
        details: expect.objectContaining({
          accountHandle: "@livehandle",
          subscriptionType: "Premium",
          code: "long_post_not_permitted",
          limit: 280,
          actual: 455,
        }),
      });
    });

    it("should reject oversized images before calling the X upload API", async () => {
      mockedFs.readFileSync.mockReturnValue(Buffer.alloc(X_MAX_IMAGE_SIZE_BYTES + 1));

      await expect(
        publisher.postContent(
          { text: "Oversized image", media: [{ type: "image", path: "/path/to/oversized.jpg" }] },
          options,
        ),
      ).rejects.toMatchObject({
        errorType: PostErrorType.INVALID_CONTENT,
        details: expect.objectContaining({
          platform: "x",
          accountHandle: "@simplepost",
          code: "image_too_large",
          limit: X_MAX_IMAGE_SIZE_BYTES,
          actual: X_MAX_IMAGE_SIZE_BYTES + 1,
        }),
      });
      expect(mockV2Client.uploadMedia).not.toHaveBeenCalled();
    });

    it("should create a native quote post", async () => {
      mockV2Client.tweet.mockResolvedValue({ data: { id: "quote_tweet_id" } });

      const result = await publisher.quote({ text: "My take" }, { postId: "original_tweet_id" }, options);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("My take", {
        media: undefined,
        reply: undefined,
        quote_tweet_id: "original_tweet_id",
      });
      expect(result).toEqual({ id: "quote_tweet_id", error: PostErrorType.NO_ERROR });
    });
  });

  describe("token refresh", () => {
    const expiredCredentialsOptions = (): PostOptionsWithCredentials => ({
      x: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          accessToken: "expired_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: nearExpiredTimestamp(),
        },
      },
    });

    const expiredPublicClientOptions = (): PostOptionsWithCredentials => ({
      x: {
        credentials: {
          clientId: "test_client_id",
          accessToken: "expired_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: nearExpiredTimestamp(),
        },
      },
    });

    it("should not refresh when the cached access token is still valid", async () => {
      publisher = new XPublisher(validCredentialsOptions());
      mockV2Client.tweet.mockResolvedValue({ data: { id: "oauth_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello!" });

      expect(result).toEqual({ id: "oauth_tweet_123", error: PostErrorType.NO_ERROR });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should refresh when the cached token is near expiry", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "refreshed_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello after refresh!" });

      expect(mockedAxios.post).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.any(URLSearchParams), {
        timeout: 30_000,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from("test_client_id:test_client_secret").toString("base64")}`,
        },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("new_access_token");
      expect(result).toEqual({
        id: "refreshed_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_access_token",
            refreshToken: "new_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should never refresh when access-token-only credentials are provided", async () => {
      publisher = new XPublisher({
        x: { credentials: { clientId: "test_client_id", accessToken: "static_access_token" } },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "static_tweet_123" } });

      const result = await publisher.postContent({ text: "Access-token-only post" });

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(MockedTwitterApi).toHaveBeenCalledWith("static_access_token");
      expect(result).toEqual({ id: "static_tweet_123", error: PostErrorType.NO_ERROR });
      expect(result.extraData).toBeUndefined();
    });

    it("should refresh on first use when only a refresh token is provided", async () => {
      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      });
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "fresh_access_token", refresh_token: "fresh_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "fresh_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello from refresh-only credentials!" });

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(MockedTwitterApi).toHaveBeenLastCalledWith("fresh_access_token");
      expect(result).toEqual({
        id: "fresh_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "fresh_access_token",
            refreshToken: "fresh_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should refresh a public client (no client secret) without Basic auth", async () => {
      publisher = new XPublisher(expiredPublicClientOptions());
      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: "new_public_access_token",
          refresh_token: "new_public_refresh_token",
          expires_in: 7200,
        },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "public_refreshed_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello from public OAuth!" });

      expect(mockedAxios.post).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.any(URLSearchParams), {
        timeout: 30_000,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("new_public_access_token");
      expect(result).toEqual({
        id: "public_refreshed_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_public_access_token",
            refreshToken: "new_public_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should propagate token refresh failures as CREDENTIALS_ERROR", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockRejectedValue({
        response: { data: { error: "invalid_grant" } },
        message: "Request failed",
      });

      await expect(publisher.postContent({ text: "This should fail" })).rejects.toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "Failed to refresh X access token", { error: "invalid_grant" }),
      );
    });

    it("should reuse a refreshed token for subsequent posts within the same publisher", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "first_tweet" } });

      await publisher.postContent({ text: "First post with refresh" });

      jest.clearAllMocks();
      MockedTwitterApi.mockImplementation(() => mockTwitterClient);
      mockV2Client.tweet.mockResolvedValue({ data: { id: "second_tweet" } });

      const result = await publisher.postContent({ text: "Second post" });

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "second_tweet",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_access_token",
            refreshToken: "new_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });
  });

  describe("validate", () => {
    it("should reject when too many images are provided", () => {
      const content: Content = {
        text: "Too many images",
        media: [
          { type: "image", path: "/path/1.jpg" },
          { type: "image", path: "/path/2.jpg" },
          { type: "image", path: "/path/3.jpg" },
          { type: "image", path: "/path/4.jpg" },
          { type: "image", path: "/path/5.jpg" },
        ],
      };

      const result = XPublisher.validate(content);

      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("too_many_images");
    });

    it("should error when mixing images and videos", () => {
      const content: Content = {
        text: "Mixed media",
        media: [
          { type: "image", path: "/path/1.jpg" },
          { type: "video", path: "/path/1.mp4" },
        ],
      };

      const result = XPublisher.validate(content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("mixed_media_not_supported");
    });

    it("should warn (not error) when text is longer than 280 but within long-post max", () => {
      const text = "a".repeat(281);
      const result = XPublisher.validate({ text, media: [{ type: "image", path: "/path/1.jpg" }] });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "long_post",
          limit: 280,
          actual: 281,
          message:
            "X counts this post as 281 characters, which requires X Premium long-post access. Shorten it to 280 weighted characters or split it into a thread if the account is not eligible.",
        }),
      );
    });

    it("should error when text exceeds long-post max", () => {
      const text = "a".repeat(25_001);
      const result = XPublisher.validate({ text });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "text_too_long")).toBe(true);
    });
  });

  describe("post (entry method)", () => {
    beforeEach(() => {
      publisher = new XPublisher(validCredentialsOptions());
    });

    it("should post content successfully and return PostResult", async () => {
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_123" } });

      const result = await publisher.post({ text: "Hello, X!" });

      expect(result).toEqual({ id: "tweet_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should return validation errors as PostResult", async () => {
      const result = await publisher.post({});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "X content validation failed",
        details: expect.anything(),
      });
    });

    it("should wrap API errors in a PostResult", async () => {
      mockV2Client.tweet.mockRejectedValue(new Error("API Error"));

      const result = await publisher.post({ text: "This will fail" });

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Failed to post content: Error: API Error",
        details: {
          platform: "x",
          accountHandle: "@simplepost",
          provider: undefined,
        },
      });
    });

    it("should wrap token refresh errors in a PostResult", async () => {
      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            accessToken: "expired_access_token",
            refreshToken: "test_refresh_token",
            expiresAt: nearExpiredTimestamp(),
          },
        },
      });
      mockedAxios.post.mockRejectedValue({
        response: { data: { error: "invalid_grant" } },
        message: "Request failed",
      });

      const result = await publisher.post({ text: "This should fail due to refresh error" });

      expect(result).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "Failed to refresh X access token",
        details: { error: "invalid_grant" },
      });
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(XPublisher.prototype, "validateReadiness").mockResolvedValue([]));
