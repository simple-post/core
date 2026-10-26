import fs from "node:fs";

import axios from "axios";

import { TikTokPublisher } from "../src/publishers/tiktok";
import { PostError, PostErrorType } from "../src/types";
import { inspectRemoteMedia } from "../src/utils/media-inspection";
import { S3MediaUploader } from "../src/utils/s3";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("../src/utils/media-inspection", () => ({ inspectRemoteMedia: jest.fn() }));
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://media.example.com/photo.jpg"),
    uploadStream: jest.fn().mockResolvedValue("https://media.example.com/staged-photo.jpg"),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("TikTokPublisher", () => {
  let publisher: TikTokPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables
    process.env.TIKTOK_ACCESS_TOKEN = "test_access_token";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    // Remote photos are re-staged on our own storage, so the publisher asks the
    // inspector for the bytes it verified.
    jest
      .mocked(inspectRemoteMedia)
      .mockReset()
      .mockResolvedValue({ contentType: "image/jpeg", size: 1024, bytes: Buffer.from("jpeg-bytes") });

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ size: 1024 * 1024 } as any); // 1MB file

    // Create a new publisher instance
    publisher = new TikTokPublisher({
      tiktok: {
        credentials: {
          accessToken: "test_access_token",
        },
      },
    });
  });

  function mockCreatorInfoOnce(overrides: Record<string, unknown> = {}) {
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        data: {
          creator_username: "simplepost",
          creator_nickname: "SimplePost",
          privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: false,
          max_video_post_duration_sec: 300,
          ...overrides,
        },
        error: { code: "ok", message: "" },
      },
    });
  }

  const directOptions: PostOptionsWithCredentials = {
    tiktok: {
      privacyLevel: "PUBLIC_TO_EVERYONE",
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      credentials: {
        accessToken: "test_access_token",
      },
    },
  };

  describe("video upload chunks", () => {
    const mib = 1024 * 1024;

    it.each([
      [1, 1, 1],
      [mib, mib, 1],
      [10 * mib, 10 * mib, 1],
      [10 * mib + 1, 10 * mib + 1, 1],
      [11_096_087, 11_096_087, 1],
      [20 * mib - 1, 20 * mib - 1, 1],
      [20 * mib, 10 * mib, 2],
      [25 * mib, 10 * mib, 2],
      [64 * mib + 1, 10 * mib, 6],
      [4 * 1024 * mib, 10 * mib, 409],
    ])("plans %i bytes using chunk size %i and %i chunks", (fileSize, chunkSize, totalChunks) => {
      expect(TikTokPublisher["calculateChunks"](fileSize)).toEqual({ chunkSize, totalChunks });
    });

    it.each([0, -1, Number.NaN, 4 * 1024 * mib + 1])("rejects invalid size %i before initialization", (size) => {
      expect(() => TikTokPublisher["calculateChunks"](size)).toThrow(
        expect.objectContaining({ errorType: PostErrorType.INVALID_CONTENT }),
      );
    });

    it.each(["public", "draft"] as const)(
      "uploads the declared chunks with all trailing bytes in %s mode",
      async (mode) => {
        const file = Buffer.alloc(25 * mib, 7);
        mockedFs.statSync.mockReturnValue({ size: file.length } as any);
        jest.spyOn(fs, "createReadStream").mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            yield file;
          },
        } as any);
        if (mode === "public") mockCreatorInfoOnce();
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: { data: { publish_id: "publish_chunks", upload_url: "https://upload.tiktok.com/video" } },
        });
        if (mode === "public") {
          mockAxiosInstance.post.mockResolvedValueOnce({
            data: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["public_chunks"] } },
          });
        }
        mockedAxios.put.mockResolvedValue({ status: 201 });
        const result = await publisher.postContent(
          { media: [{ type: "video", path: "./test-video.mp4" }] },
          { tiktok: { ...directOptions.tiktok, credentials: { accessToken: "test_access_token" }, publishMode: mode } },
        );
        expect(result.error).toBe(PostErrorType.NO_ERROR);
        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          mode === "public" ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/",
          expect.objectContaining({
            source_info: { source: "FILE_UPLOAD", video_size: file.length, chunk_size: 10 * mib, total_chunk_count: 2 },
          }),
        );
        expect(mockedAxios.put).toHaveBeenCalledTimes(2);
        const calls = mockedAxios.put.mock.calls;
        expect(calls[0][2]?.headers).toEqual({
          "Content-Type": "video/mp4",
          "Content-Length": String(10 * mib),
          "Content-Range": `bytes 0-${10 * mib - 1}/${file.length}`,
        });
        expect(calls[1][2]?.headers).toEqual({
          "Content-Type": "video/mp4",
          "Content-Length": String(15 * mib),
          "Content-Range": `bytes ${10 * mib}-${file.length - 1}/${file.length}`,
        });
        expect(Buffer.concat(calls.map((call) => call[1] as Buffer)).equals(file)).toBe(true);
      },
    );

    it.each(["public", "draft"] as const)(
      "declares the full video size for a single chunk in %s mode",
      async (mode) => {
        const file = Buffer.alloc(11_096_087, 7);
        mockedFs.statSync.mockReturnValue({ size: file.length } as any);
        jest.spyOn(fs, "createReadStream").mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            yield file;
          },
        } as any);
        if (mode === "public") mockCreatorInfoOnce();
        mockAxiosInstance.post.mockImplementation(
          async (
            url: string,
            body: { source_info: { total_chunk_count: number; chunk_size: number; video_size: number } },
          ) => {
            if (url.endsWith("/init/")) {
              if (
                body.source_info.total_chunk_count === 1 &&
                body.source_info.chunk_size !== body.source_info.video_size
              ) {
                throw {
                  response: {
                    status: 400,
                    data: { error: { code: "invalid_params", message: "The chunk size is invalid" } },
                  },
                };
              }
              return { data: { data: { publish_id: "single_chunk", upload_url: "https://upload.tiktok.com/video" } } };
            }
            return { data: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["single_chunk"] } } };
          },
        );
        mockedAxios.put.mockResolvedValue({ status: 201 });
        const result = await publisher.postContent(
          { media: [{ type: "video", path: "./test-video.mp4" }] },
          { tiktok: { ...directOptions.tiktok, credentials: { accessToken: "test_access_token" }, publishMode: mode } },
        );
        expect(result.error).toBe(PostErrorType.NO_ERROR);
        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          mode === "public" ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/",
          expect.objectContaining({
            source_info: {
              source: "FILE_UPLOAD",
              video_size: file.length,
              chunk_size: file.length,
              total_chunk_count: 1,
            },
          }),
        );
        expect(mockedAxios.put).toHaveBeenCalledTimes(1);
        expect(mockedAxios.put).toHaveBeenCalledWith(
          "https://upload.tiktok.com/video",
          file,
          expect.objectContaining({
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(file.length),
              "Content-Range": `bytes 0-${file.length - 1}/${file.length}`,
            },
          }),
        );
      },
    );

    describe.each(["public", "draft"] as const)("%s initialization failures", (mode) => {
      it.each([
        [400, "invalid_params", PostErrorType.PUBLISH_REJECTED],
        [401, "access_token_invalid", PostErrorType.PUBLISH_REJECTED],
        [403, "scope_not_authorized", PostErrorType.PUBLISH_REJECTED],
        [404, "not_found", PostErrorType.PUBLISH_REJECTED],
        [429, "rate_limit_exceeded", PostErrorType.PUBLISH_REJECTED],
        [408, "timeout", PostErrorType.API_ERROR],
        [500, "internal_error", PostErrorType.API_ERROR],
        [400, undefined, PostErrorType.API_ERROR],
        [undefined, undefined, PostErrorType.API_ERROR],
      ])("classifies HTTP %s / %s as %s", async (status, code, errorType) => {
        if (mode === "public") mockCreatorInfoOnce();
        mockAxiosInstance.post.mockRejectedValueOnce({
          message: "Request failed",
          ...(status ? { response: { status, data: { error: { code, message: "Initialization rejected" } } } } : {}),
        });
        await expect(
          publisher.postContent(
            { media: [{ type: "video", path: "./test-video.mp4" }] },
            {
              tiktok: { ...directOptions.tiktok, credentials: { accessToken: "test_access_token" }, publishMode: mode },
            },
          ),
        ).rejects.toMatchObject({ errorType });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(mode === "public" ? 2 : 1);
        expect(mockedAxios.put).not.toHaveBeenCalled();
      });
    });
  });

  describe("bounded video recovery", () => {
    const content: Content = { media: [{ type: "video", path: "./test-video.mp4" }] };
    let sessions: number;

    beforeEach(() => {
      jest.useFakeTimers();
      sessions = 0;
      const file = Buffer.alloc(1024 * 1024);
      jest.spyOn(fs, "createReadStream").mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield file;
        },
      } as any);
      mockedAxios.put.mockReset().mockResolvedValue({ status: 201 });
      mockCreatorInfoOnce();
      mockAxiosInstance.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/init/")) {
          sessions += 1;
          return {
            data: { data: { publish_id: `publish_${sessions}`, upload_url: `https://upload.tiktok.com/${sessions}` } },
          };
        }
        return { data: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["public_video"] } } };
      });
    });

    afterEach(() => jest.useRealTimers());

    it("restarts rejected sessions after 1s and 3s, then polls only the accepted session", async () => {
      mockedAxios.put
        .mockRejectedValueOnce({ response: { status: 403 } })
        .mockRejectedValueOnce({ response: { status: 404 } });
      const result = publisher.postContent(content, directOptions);
      await jest.advanceTimersByTimeAsync(999);
      expect(sessions).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(sessions).toBe(2);
      await jest.advanceTimersByTimeAsync(2999);
      expect(sessions).toBe(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ id: "public_video", error: PostErrorType.NO_ERROR });
      expect(mockedAxios.put.mock.calls.map(([url]) => url)).toEqual([
        "https://upload.tiktok.com/1",
        "https://upload.tiktok.com/2",
        "https://upload.tiktok.com/3",
      ]);
      expect(mockAxiosInstance.post.mock.calls.filter(([url]: [string]) => url.includes("creator_info"))).toHaveLength(
        1,
      );
      expect(mockAxiosInstance.post).toHaveBeenLastCalledWith("/v2/post/publish/status/fetch/", {
        publish_id: "publish_3",
      });
    });

    it("stops after three rejected sessions without retaining tokens or signed URLs", async () => {
      const secret = "Bearer secret https://upload.tiktok.com/?upload_token=secret";
      mockedAxios.put.mockRejectedValue({ response: { status: 404 }, message: secret, config: { url: secret } });
      const result = publisher.postContent(content, directOptions).catch((error) => error);
      await jest.runAllTimersAsync();
      const error = await result;
      expect(error).toMatchObject({
        errorType: PostErrorType.PUBLISH_REJECTED,
        details: { phase: "upload", httpStatus: 404 },
      });
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain("secret");
      expect(sessions).toBe(3);
      expect(mockedAxios.put).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post.mock.calls.some(([url]: [string]) => url.includes("status/fetch"))).toBe(false);
    });

    it.each([undefined, 400, 401, 408, 416, 429, 500, 503])(
      "does not restart an upload after HTTP %s",
      async (status) => {
        mockedAxios.put.mockRejectedValue({ response: { status }, message: "Uncertain upload" });
        await expect(publisher.postContent(content, directOptions)).rejects.toMatchObject({
          errorType: PostErrorType.API_ERROR,
        });
        expect(sessions).toBe(1);
        expect(mockedAxios.put).toHaveBeenCalledTimes(1);
      },
    );

    it("stops immediately if the replacement session has an ambiguous upload outcome", async () => {
      mockedAxios.put.mockRejectedValueOnce({ response: { status: 404 } }).mockRejectedValueOnce(new Error("timeout"));
      const result = publisher.postContent(content, directOptions).catch((error) => error);
      await jest.runAllTimersAsync();
      expect(await result).toMatchObject({ errorType: PostErrorType.API_ERROR });
      expect(sessions).toBe(2);
      expect(mockedAxios.put).toHaveBeenCalledTimes(2);
    });

    it("starts the replacement session at byte zero after a later chunk is rejected", async () => {
      const size = 25 * 1024 * 1024;
      mockedFs.statSync.mockReturnValue({ size } as any);
      jest.spyOn(fs, "createReadStream").mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.alloc(size);
        },
      } as any);
      mockedAxios.put.mockResolvedValueOnce({ status: 206 }).mockRejectedValueOnce({ response: { status: 404 } });
      const result = publisher.postContent(content, directOptions);
      await jest.runAllTimersAsync();
      await result;
      expect(mockedAxios.put).toHaveBeenCalledTimes(4);
      expect(mockedAxios.put.mock.calls[2][0]).toBe("https://upload.tiktok.com/2");
      expect(mockedAxios.put.mock.calls[2][2]?.headers?.["Content-Range"]).toBe(`bytes 0-10485759/${size}`);
    });

    it("also recovers draft uploads without polling or creator validation", async () => {
      mockAxiosInstance.post.mockReset().mockImplementation(async () => {
        sessions += 1;
        return {
          data: { data: { publish_id: `draft_${sessions}`, upload_url: `https://upload.tiktok.com/${sessions}` } },
        };
      });
      mockedAxios.put.mockRejectedValueOnce({ response: { status: 404 } });
      const result = publisher.postContent(content, { tiktok: { ...directOptions.tiktok!, publishMode: "draft" } });
      await jest.runAllTimersAsync();
      expect(await result).toMatchObject({ id: "draft_2", error: PostErrorType.NO_ERROR });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenLastCalledWith("/v2/post/publish/inbox/video/init/", expect.any(Object));
    });

    it("gates every initialization, including a replacement session, before making the request", async () => {
      const beforeUploadInit = jest
        .fn()
        .mockImplementationOnce(async () => {})
        .mockRejectedValueOnce(
          new PostError(PostErrorType.RATE_LIMIT_ERROR, "Account request budget is full", { localRateLimit: true }),
        );
      publisher = new TikTokPublisher({ tiktok: { ...directOptions.tiktok!, beforeUploadInit } });
      mockedAxios.put.mockRejectedValueOnce({ response: { status: 404 } });
      const result = publisher.postContent(content, directOptions).catch((error) => error);
      await jest.runAllTimersAsync();
      expect(await result).toMatchObject({
        errorType: PostErrorType.RATE_LIMIT_ERROR,
        details: { localRateLimit: true },
      });
      expect(beforeUploadInit).toHaveBeenCalledTimes(2);
      expect(sessions).toBe(1);
      expect(mockedAxios.put).toHaveBeenCalledTimes(1);
    });

    it.each(["public", "draft"] as const)("preserves TikTok's pending-share diagnosis in %s mode", async (mode) => {
      if (mode === "draft") mockAxiosInstance.post.mockReset();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 400, data: { error: { code: "spam_risk_too_many_pending_share", log_id: "safe_log_id" } } },
        config: { headers: { Authorization: "Bearer secret" } },
      });
      await expect(
        publisher.postContent(content, { tiktok: { ...directOptions.tiktok!, publishMode: mode } }),
      ).rejects.toMatchObject({
        errorType: PostErrorType.PUBLISH_REJECTED,
        message: expect.stringContaining("pending-upload limit"),
        details: { phase: "init", code: "spam_risk_too_many_pending_share", logId: "safe_log_id" },
      });
      expect(mockedAxios.put).not.toHaveBeenCalled();
    });

    it.each([
      [{ error: { code: "rate_limit_exceeded" } }, PostErrorType.PUBLISH_REJECTED],
      [{ data: { publish_id: "incomplete" } }, PostErrorType.API_ERROR],
    ])("rejects unsuccessful initialization envelopes without uploading or retrying", async (data, errorType) => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data });
      await expect(publisher.postContent(content, directOptions)).rejects.toMatchObject({ errorType });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockedAxios.put).not.toHaveBeenCalled();
    });

    it.each(["processing", "transport failure", "error envelope"])(
      "never reports success after status polling ends on %s",
      async (failure) => {
        const init = mockAxiosInstance.post.getMockImplementation();
        mockAxiosInstance.post.mockImplementation(async (url: string) => {
          if (url.endsWith("/init/")) return init(url);
          if (failure === "transport failure") throw new Error("secret signed URL");
          return {
            data: {
              data: { status: failure === "processing" ? "PROCESSING_UPLOAD" : "PUBLISH_COMPLETE" },
              ...(failure === "error envelope" ? { error: { code: "rate_limit_exceeded" } } : {}),
            },
          };
        });
        const result = publisher.postContent(content, directOptions).catch((error) => error);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({
          errorType: PostErrorType.API_ERROR,
          details: { phase: "status", publishId: "publish_1" },
        });
        expect(sessions).toBe(1);
        expect(mockedAxios.put).toHaveBeenCalledTimes(1);
      },
    );

    it("accepts confirmed publication even when no public ID is available", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { data: { publish_id: "confirmed", upload_url: "https://upload.tiktok.com/1" } },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { data: { status: "PUBLISH_COMPLETE" } } });
      expect(await publisher.postContent(content, directOptions)).toMatchObject({
        id: "confirmed",
        error: PostErrorType.NO_ERROR,
      });
    });
  });

  describe("constructor", () => {
    it.each(["timeout", "server-error", "missing-data"])(
      "keeps a creator-info %s safely retryable without uploading",
      async (kind) => {
        if (kind === "missing-data") mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });
        else
          mockAxiosInstance.post.mockRejectedValueOnce(
            kind === "timeout" ? { code: "ETIMEDOUT" } : { response: { status: 503, data: {} } },
          );
        await expect(
          publisher.postContent({ media: [{ type: "video", path: "./test-video.mp4" }] }, directOptions),
        ).rejects.toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: expect.stringContaining("No upload was submitted"),
          details: { phase: "creator_info" },
        });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.put).not.toHaveBeenCalled();
      },
    );
    it.each([
      "spam_risk_too_many_posts",
      "reached_active_user_cap",
      "rate_limit_exceeded",
      "scope_not_authorized",
      "spam_risk_user_banned_from_posting",
    ])("keeps a %s creator-info rejection safely recoverable before upload", async (code) => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { error: { code, log_id: "safe_log_id" } } });
      await expect(
        publisher.postContent({ media: [{ type: "video", path: "./test-video.mp4" }] }, directOptions),
      ).rejects.toMatchObject({
        errorType: PostErrorType.PUBLISH_REJECTED,
        details: { phase: "creator_info", code, logId: "safe_log_id" },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.put).not.toHaveBeenCalled();
    });
    it("should throw an error if credentials are missing", () => {
      expect(() => {
        new TikTokPublisher({});
      }).toThrow(PostError);
    });

    it("should create instance with valid credentials", () => {
      expect(publisher).toBeInstanceOf(TikTokPublisher);
    });
  });

  describe("postContent", () => {
    const videoContent: Content = {
      text: "Test TikTok video!",
      media: [{ type: "video", path: "./test-video.mp4" }],
    };

    const photoContent: Content = {
      text: "Test TikTok photo!",
      media: [{ type: "image", path: "./test-image.jpg" }],
    };

    it("should successfully post a video", async () => {
      // Mock the Direct Post API init response (includes publish_id directly)
      mockCreatorInfoOnce();
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_123",
              upload_url: "https://upload.tiktok.com/video?upload_id=123",
            },
          },
        })
        // Status poll resolves the public post id used in the URL
        .mockResolvedValueOnce({
          data: {
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["7298765432109876543"],
            },
          },
        });

      // Mock axios PUT for file upload
      mockedAxios.put.mockResolvedValue({ status: 200 });

      // Mock fs.createReadStream
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("chunk1");
          yield Buffer.from("chunk2");
        },
      };
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      const result = await publisher.postContent(videoContent, directOptions);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("7298765432109876543");
      // 3 POSTs expected: creator info + init + status fetch (resolves on first attempt)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/v2/post/publish/creator_info/query/");
      // Verify the init call includes post_info
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/video/init/",
        expect.objectContaining({
          post_info: expect.objectContaining({
            title: "Test TikTok video!",
            privacy_level: "PUBLIC_TO_EVERYONE",
          }),
          source_info: expect.any(Object),
        }),
      );
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/status/fetch/",
        expect.objectContaining({ publish_id: "publish_123" }),
      );
    });

    it("publishes a GET-readable photo without requiring HEAD", async () => {
      const bytes = Buffer.from("inspected photo bytes");
      jest.mocked(inspectRemoteMedia).mockResolvedValueOnce({ contentType: "image/jpeg", size: bytes.length, bytes });
      mockedAxios.head.mockRejectedValueOnce({ response: { status: 405 } });
      mockCreatorInfoOnce();
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { data: { publish_id: "photo-id" } } })
        .mockResolvedValueOnce({
          data: { data: { status: "PUBLISH_COMPLETE", publicly_available_post_id: ["public-id"] } },
        });
      const result = await publisher.postContent(
        { text: "Photo", media: [{ type: "image", url: "https://images.example/photo" }] },
        directOptions,
      );
      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.head).not.toHaveBeenCalled();
      expect(inspectRemoteMedia).toHaveBeenCalledWith("https://images.example/photo", {
        maxRedirects: 0,
        includeBytes: true,
      });
      // Arbitrary hosts are not verified for our TikTok app, so the exact bytes
      // that passed inspection are submitted from our storage instead.
      const uploader = jest.mocked(S3MediaUploader).mock.results[0].value;
      expect(uploader.uploadStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/\.jpg$/),
        "image/jpeg",
      );
      const uploadedChunks: Buffer[] = [];
      for await (const chunk of uploader.uploadStream.mock.calls[0][0]) uploadedChunks.push(chunk);
      expect(Buffer.concat(uploadedChunks)).toEqual(bytes);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/content/init/",
        expect.objectContaining({
          source_info: expect.objectContaining({ photo_images: ["https://media.example.com/staged-photo.jpg"] }),
        }),
      );
    });

    it("keeps failed photo inspection retryable without submitting a post", async () => {
      mockCreatorInfoOnce();
      jest.mocked(inspectRemoteMedia).mockRejectedValueOnce(new Error("Media unavailable"));
      await expect(publisher.postContent(photoContent, directOptions)).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1); // creator info only
    });

    it("keeps a timeout during photo submission ambiguous", async () => {
      mockCreatorInfoOnce();
      mockAxiosInstance.post.mockRejectedValueOnce({ code: "ETIMEDOUT", message: "Timed out" });
      await expect(publisher.postContent(photoContent, directOptions)).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
      });
    });

    it("should successfully post a photo", async () => {
      // Mock the Direct Post API init response for photos
      mockCreatorInfoOnce();
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_456",
              upload_url: "https://upload.tiktok.com/photo?upload_id=456",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["7298765432109876544"],
            },
          },
        });

      // Mock axios PUT for file upload
      mockedAxios.put.mockResolvedValue({ status: 200 });

      // Mock fs.createReadStream
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("chunk1");
        },
      };
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      const result = await publisher.postContent(photoContent, directOptions);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("7298765432109876544");
      // 3 POSTs expected: creator info + init + status fetch
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      // Verify photo endpoint is used
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/content/init/",
        expect.objectContaining({
          post_info: expect.any(Object),
          source_info: expect.any(Object),
        }),
      );
    });

    it("should handle different visibility settings", async () => {
      // Mock the Direct Post API response
      mockCreatorInfoOnce();
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_789",
              upload_url: "https://upload.tiktok.com/video?upload_id=789",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["7298765432109876545"],
            },
          },
        });

      // Mock axios PUT for file upload
      mockedAxios.put.mockResolvedValue({ status: 200 });

      // Mock fs.createReadStream
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("chunk1");
        },
      };
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      const options: PostOptionsWithCredentials = {
        tiktok: {
          visibility: "private",
          allowComment: false,
          allowDuet: false,
          allowStitch: false,
          credentials: {
            accessToken: "test_access_token",
          },
        },
      };

      const result = await publisher.postContent(videoContent, options);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("7298765432109876545");

      // Verify the init call includes the privacy settings
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/video/init/",
        expect.objectContaining({
          post_info: expect.objectContaining({
            title: "Test TikTok video!",
            privacy_level: "SELF_ONLY",
            disable_comment: true,
            disable_duet: true,
            disable_stitch: true,
          }),
        }),
      );
    });

    it("should upload to draft (inbox) when publishMode is 'draft'", async () => {
      // Mock the Upload Video API (inbox) response
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            publish_id: "draft_123",
            upload_url: "https://upload.tiktok.com/video?upload_id=draft_123",
          },
        },
      });

      // Mock axios PUT for file upload
      mockedAxios.put.mockResolvedValue({ status: 200 });

      // Mock fs.createReadStream
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("chunk1");
        },
      };
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      const options: PostOptionsWithCredentials = {
        tiktok: {
          publishMode: "draft",
          credentials: {
            accessToken: "test_access_token",
          },
        },
      };

      const result = await publisher.postContent(videoContent, options);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("draft_123");

      // Verify the inbox init endpoint was called (without post_info)
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/inbox/video/init/",
        expect.objectContaining({
          source_info: expect.any(Object),
        }),
      );

      // Verify post_info was NOT included for draft mode
      expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          post_info: expect.anything(),
        }),
      );
    });

    it("should throw error for missing media", async () => {
      const contentWithoutMedia: Content = {
        text: "Test without media",
      };

      await expect(publisher.postContent(contentWithoutMedia)).rejects.toThrow(PostError);
    });

    it("should throw error for non-existent file", async () => {
      mockedFs.existsSync.mockReturnValue(false);

      await expect(publisher.postContent(videoContent)).rejects.toThrow(PostError);
    });

    it("should publish all images in one photo post", async () => {
      const contentWithMultipleMedia: Content = {
        text: "Test with multiple images",
        media: [
          { type: "image", path: "./test1.jpg" },
          { type: "image", path: "./test2.jpg" },
        ],
      };

      // Create publisher in strict mode to test the warning
      const strictPublisher = new TikTokPublisher({
        common: { strictMode: false },
        tiktok: {
          credentials: {
            accessToken: "test_access_token",
          },
        },
      });

      // Mock successful upload for the first image using Direct Post API
      mockCreatorInfoOnce();
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_multi",
              upload_url: "https://upload.tiktok.com/photo?upload_id=multi",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              status: "PUBLISH_COMPLETE",
              publicaly_available_post_id: ["7298765432109876546"],
            },
          },
        });

      mockedAxios.put.mockResolvedValue({ status: 200 });

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("chunk1");
        },
      };
      jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);

      const result = await strictPublisher.postContent(contentWithMultipleMedia, directOptions);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      // 3 POSTs expected: creator info + init + status fetch
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it("should handle API errors gracefully", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          data: {
            error: {
              message: "Invalid access token",
            },
          },
        },
      });

      await expect(publisher.postContent(videoContent)).rejects.toThrow(PostError);
    });
  });

  describe("validation", () => {
    it("should error when caption is too long for video", () => {
      const longCaption = "a".repeat(2300);
      const contentWithLongCaption: Content = {
        text: longCaption,
        media: [{ type: "video", path: "./test-video.mp4" }],
      };

      const result = TikTokPublisher.validate(contentWithLongCaption);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("caption_too_long");
    });

    it("should accept multiple photo attachments", () => {
      const contentWithMultipleMedia: Content = {
        text: "Multiple media",
        media: [
          { type: "image", path: "./test-image-1.jpg" },
          { type: "image", path: "./test-image-2.jpg" },
        ],
      };

      const result = TikTokPublisher.validate(contentWithMultipleMedia);

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(TikTokPublisher.prototype, "validateReadiness").mockResolvedValue([]));
