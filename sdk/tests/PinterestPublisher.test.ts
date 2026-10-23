import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import { PinterestPublisher } from "../src/publishers/pinterest";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://cdn.example.com/image.jpg"),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("PinterestPublisher", () => {
  let publisher: PinterestPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    publisher = new PinterestPublisher({
      pinterest: {
        boardId: "board_123",
        credentials: {
          accessToken: "test_access_token",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new PinterestPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("waits for slow processing without registering or uploading the video again", async () => {
      jest.useFakeTimers();
      const videoPath = path.join(process.cwd(), `.pinterest-slow-${Date.now()}.mp4`);
      fs.writeFileSync(videoPath, "video fixture");
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            media_id: "media_123",
            upload_url: "https://uploads.pinterest.test/media",
            upload_parameters: { policy: "test" },
          },
        })
        .mockResolvedValueOnce({ data: { id: "pin_123" } });
      for (let i = 0; i < 40; i += 1) mockAxiosInstance.get.mockResolvedValueOnce({ data: { status: "processing" } });
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { status: "succeeded" } });
      mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);
      try {
        const result = publisher.postContent(
          { media: [{ type: "video", path: videoPath }] },
          {
            pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
          },
        );
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "pin_123" });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
        fs.rmSync(videoPath, { force: true });
      }
    });
    describe("bounded video preparation recovery", () => {
      const options: PostOptionsWithCredentials = {
        pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
      };
      const registration = {
        data: { media_id: "media_123", upload_url: "https://uploads.pinterest.test/media?sig=SECRET" },
      };
      let videoPath: string;
      let streams: fs.ReadStream[];
      let createReadStream: jest.SpyInstance;
      const pinCalls = () => mockAxiosInstance.post.mock.calls.filter((call: unknown[]) => call[0] === "/pins");
      const post = () => publisher.postContent({ media: [{ type: "video", path: videoPath }] }, options);

      beforeEach(() => {
        jest.useFakeTimers();
        videoPath = path.join(process.cwd(), `.pinterest-retry-${process.pid}-${Math.random()}.mp4`);
        fs.writeFileSync(videoPath, "video fixture");
        streams = [];
        const original = fs.createReadStream;
        createReadStream = jest.spyOn(fs, "createReadStream").mockImplementation((...args) => {
          const stream = original(...args);
          streams.push(stream);
          return stream;
        });
      });
      afterEach(() => {
        createReadStream.mockRestore();
        jest.useRealTimers();
        fs.rmSync(videoPath, { force: true });
      });

      it("retries transient registration and upload failures with fresh streams before one Pin", async () => {
        mockAxiosInstance.post
          .mockRejectedValueOnce({ response: { status: 503, data: { message: "Unavailable" } } })
          .mockResolvedValueOnce(registration)
          .mockResolvedValueOnce({ data: { id: "pin_retry" } });
        mockedAxios.post.mockRejectedValueOnce({ code: "ECONNRESET" }).mockResolvedValueOnce({ status: 204 } as any);
        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { status: "registered" } })
          .mockResolvedValueOnce({ data: { status: "succeeded" } });

        const result = post();
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ id: "pin_retry", error: PostErrorType.NO_ERROR });
        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        expect(streams).toHaveLength(2);
        expect(streams.every((stream) => stream.destroyed)).toBe(true);
        expect(pinCalls()).toHaveLength(1);
        expect(pinCalls()[0][1].media_source.media_id).toBe("media_123");
      });

      it("reuses media Pinterest already received after an ambiguous upload instead of resending", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration).mockResolvedValueOnce({ data: { id: "pin_kept" } });
        mockedAxios.post.mockRejectedValueOnce({ code: "ECONNABORTED", message: "timeout of 600000ms exceeded" });
        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { status: "processing" } })
          .mockResolvedValueOnce({ data: { status: "succeeded" } });

        const result = post();
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ id: "pin_kept" });
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
        expect(pinCalls()).toHaveLength(1);
      });

      it("retries a transient status read with the same media ID", async () => {
        mockAxiosInstance.post
          .mockResolvedValueOnce(registration)
          .mockResolvedValueOnce({ data: { id: "pin_status" } });
        mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);
        mockAxiosInstance.get
          .mockRejectedValueOnce({ response: { status: 503 } })
          .mockResolvedValueOnce({ data: { status: "succeeded" } });

        const result = post();
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ id: "pin_status" });
        expect(mockAxiosInstance.get.mock.calls.map((call: unknown[]) => call[0])).toEqual([
          "/media/media_123",
          "/media/media_123",
        ]);
        expect(pinCalls()).toHaveLength(1);
      });

      it("gives up after bounded attempts with a retryable preparation error and no Pin", async () => {
        mockAxiosInstance.post.mockRejectedValue({
          message: "Bearer test_access_token",
          response: {
            status: 503,
            data: { message: "Bearer SECRET https://signed.example/token" },
            headers: { "x-pinterest-rid": "rid-503" },
          },
        });

        const outcome = post().catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        const error = (await outcome) as PostError;
        expect(error).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: "Pinterest did not register the video. No Pin was created. Retry the post.",
          details: { provider: "pinterest", stage: "register", status: 503, requestId: "rid-503" },
        });
        expect(JSON.stringify({ message: error.message, details: error.details })).not.toMatch(
          /Bearer|SECRET|signed\.example/,
        );
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
        expect(pinCalls()).toHaveLength(0);
      });

      it.each([
        ["register", { response: { status: 401, data: { message: "Unauthorized" } } }, PostErrorType.CREDENTIALS_ERROR],
        ["register", { response: { status: 429, headers: { "retry-after": "3600" } } }, PostErrorType.RATE_LIMIT_ERROR],
        ["status", { data: { status: "failed" } }, PostErrorType.INVALID_CONTENT],
      ])("fails fast without a Pin on a conclusive %s outcome", async (stage, outcome, errorType) => {
        if (stage === "register") mockAxiosInstance.post.mockRejectedValue(outcome);
        else {
          mockAxiosInstance.post.mockResolvedValueOnce(registration);
          mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);
          mockAxiosInstance.get.mockResolvedValue(outcome);
        }

        const result = post().catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await result).toMatchObject({ errorType, details: expect.objectContaining({ stage }) });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        expect(mockAxiosInstance.get.mock.calls.length).toBeLessThanOrEqual(1);
        expect(pinCalls()).toHaveLength(0);
      });

      it("never resubmits video Pin creation after an ambiguous timeout", async () => {
        mockAxiosInstance.post
          .mockResolvedValueOnce(registration)
          .mockRejectedValueOnce({ code: "ETIMEDOUT", message: "timeout of 30000ms exceeded" });
        mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);
        mockAxiosInstance.get.mockResolvedValue({ data: { status: "succeeded" } });

        const outcome = post().catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({ errorType: PostErrorType.API_ERROR });
        expect(pinCalls()).toHaveLength(1);
      });
    });

    it("should create an image pin successfully", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { id: "pin_123" },
      });

      const content: Content = {
        text: "Pinterest pin",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      const options: PostOptionsWithCredentials = {
        pinterest: {
          boardId: "board_123",
          credentials: {
            accessToken: "test_access_token",
          },
        },
      };

      const result = await publisher.postContent(content, options);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("pin_123");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/pins",
        expect.objectContaining({
          board_id: "board_123",
          media_source: expect.objectContaining({ source_type: "image_url" }),
        }),
      );
      expect(result.url).toBe("https://www.pinterest.com/pin/pin_123/");
    });

    it("recovers a Pin accepted before Pinterest returned transient error 2787", async () => {
      jest.useFakeTimers();
      const now = new Date().toISOString();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 400, data: { code: 2787, message: "Sorry! Something went wrong on our end." } },
      });
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "pin_recovered",
              created_at: now,
              board_id: "board_123",
              title: "Recovered pin",
              description: "Pinterest pin",
              link: "https://example.com/story",
              alt_text: "A quiet room",
            },
          ],
        },
      });

      try {
        const result = publisher.postContent(
          {
            text: "Pinterest pin",
            media: [{ type: "image", url: "https://cdn.example.com/image.jpg", caption: "A quiet room" }],
          },
          {
            pinterest: {
              boardId: "board_123",
              title: "Recovered pin",
              link: "https://example.com/story",
              credentials: { accessToken: "test_access_token" },
            },
          },
        );
        await jest.runAllTimersAsync();
        await expect(result).resolves.toMatchObject({
          id: "pin_recovered",
          url: "https://www.pinterest.com/pin/pin_recovered/",
          error: PostErrorType.NO_ERROR,
        });
      } finally {
        jest.useRealTimers();
      }

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/boards/board_123/pins", { params: { page_size: 250 } });
    });

    it("retries a confirmed-missing 2787 Pin once with direct Base64 image data", async () => {
      jest.useFakeTimers();
      const imagePath = path.join(process.cwd(), `.pinterest-fallback-${Date.now()}.jpg`);
      fs.writeFileSync(imagePath, Buffer.from([255, 216, 255, 217]));
      mockAxiosInstance.post
        .mockRejectedValueOnce({
          response: { status: 400, data: { code: 2787, message: "Sorry! Something went wrong on our end." } },
        })
        .mockResolvedValueOnce({ data: { id: "pin_retried" } });
      mockAxiosInstance.get.mockResolvedValue({ data: { items: [] } });

      try {
        const result = publisher.postContent(
          {
            text: "Pinterest pin",
            media: [{ type: "image", path: imagePath, contentType: "image/jpeg" }],
          },
          {
            pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
          },
        );
        await jest.runAllTimersAsync();
        await expect(result).resolves.toMatchObject({
          id: "pin_retried",
          url: "https://www.pinterest.com/pin/pin_retried/",
          error: PostErrorType.NO_ERROR,
        });
      } finally {
        jest.useRealTimers();
        fs.rmSync(imagePath, { force: true });
      }

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(
        "/pins",
        expect.objectContaining({
          media_source: {
            source_type: "image_base64",
            content_type: "image/jpeg",
            data: Buffer.from([255, 216, 255, 217]).toString("base64"),
          },
        }),
      );
    });

    it("does not retry 2787 when Pinterest readback cannot confirm absence", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { code: 2787, message: "Sorry! Something went wrong on our end." },
          headers: { "x-pinterest-rid": "request-2787" },
        },
      });
      mockAxiosInstance.get.mockRejectedValueOnce(new Error("Pinterest readback unavailable"));

      try {
        const result = publisher.postContent(
          { text: "Pinterest pin", media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }] },
          {
            pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
          },
        );
        const rejection = expect(result).rejects.toMatchObject({
          errorType: PostErrorType.API_ERROR,
          details: {
            provider: "pinterest",
            status: 400,
            code: 2787,
            requestId: "request-2787",
            reconciliationError: "Pinterest readback unavailable",
          },
        });
        await jest.runAllTimersAsync();
        await rejection;
      } finally {
        jest.useRealTimers();
      }

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it("records safe Pinterest diagnostics without retrying unrelated errors", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { code: 1234, message: "Invalid request" },
          headers: {
            "x-pinterest-rid": "request-1234",
            "x-ratelimit-remaining": "98",
          },
        },
      });

      await expect(
        publisher.postContent(
          { text: "Pinterest pin", media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }] },
          {
            pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
          },
        ),
      ).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
        details: {
          provider: "pinterest",
          status: 400,
          code: 1234,
          requestId: "request-1234",
          rateLimitRemaining: "98",
        },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it("should throw if boardId is missing", async () => {
      const content: Content = {
        text: "Pinterest pin",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      await expect(
        publisher.postContent(content, { pinterest: { credentials: { accessToken: "token" } } } as any),
      ).rejects.toThrow(PostError);
    });

    it("should upload, process, and publish a video with its cover image", async () => {
      const videoPath = path.join(process.cwd(), `.pinterest-video-${Date.now()}.mp4`);
      fs.writeFileSync(videoPath, "video fixture");
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            media_id: "media_123",
            upload_url: "https://uploads.pinterest.test/media",
            upload_parameters: { token: "upload-token" },
          },
        })
        .mockResolvedValueOnce({ data: { id: "pin_video_123" } });
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { status: "succeeded" } });
      mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);

      try {
        const result = await publisher.postContent(
          {
            text: "Pinterest video",
            media: [
              {
                type: "video",
                path: videoPath,
                thumbnailUrl: "https://cdn.example.com/cover.jpg",
              },
            ],
          },
          {
            pinterest: {
              boardId: "board_123",
              credentials: { accessToken: "test_access_token" },
            },
          },
        );

        expect(result.id).toBe("pin_video_123");
      } finally {
        fs.rmSync(videoPath, { force: true });
      }

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://uploads.pinterest.test/media",
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ "content-type": expect.stringContaining("multipart/form-data") }),
          maxBodyLength: Infinity,
        }),
      );
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/media/media_123", { timeout: 30_000 });
      expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(
        "/pins",
        expect.objectContaining({
          board_id: "board_123",
          media_source: {
            source_type: "video_id",
            media_id: "media_123",
            cover_image_url: "https://cdn.example.com/cover.jpg",
          },
        }),
      );
    });

    it("uses the first video frame when no thumbnail is supplied", async () => {
      const videoPath = path.join(process.cwd(), `.pinterest-cover-${Date.now()}.mp4`);
      fs.writeFileSync(videoPath, "video fixture");
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            media_id: "media_123",
            upload_url: "https://uploads.pinterest.test/media",
            upload_parameters: { policy: "policy" },
          },
        })
        .mockResolvedValueOnce({ data: { id: "pin_123" } });
      mockAxiosInstance.get.mockResolvedValue({ data: { status: "succeeded" } });
      mockedAxios.post.mockResolvedValueOnce({ status: 204 } as any);
      try {
        await publisher.postContent(
          { media: [{ type: "video", path: videoPath }] },
          {
            pinterest: { boardId: "board_123", credentials: { accessToken: "test_access_token" } },
          },
        );
        expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(
          "/pins",
          expect.objectContaining({
            media_source: { source_type: "video_id", media_id: "media_123", cover_image_key_frame_time: 0 },
          }),
        );
      } finally {
        fs.rmSync(videoPath, { force: true });
      }
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(PinterestPublisher.prototype, "validateReadiness").mockResolvedValue([]));
