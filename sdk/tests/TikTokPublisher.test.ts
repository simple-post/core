import fs from "node:fs";

import axios from "axios";

import { TikTokPublisher } from "../src/publishers/tiktok";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://media.example.com/photo.jpg"),
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
    mockedAxios.head.mockResolvedValue({ headers: { "content-type": "image/jpeg", "content-length": "1024" } });

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
      [10 * mib + 1, 10 * mib, 1],
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

    describe.each(["public", "draft"] as const)("%s initialization failures", (mode) => {
      it.each([
        [400, "invalid_params", PostErrorType.PUBLISH_REJECTED],
        [401, "access_token_invalid", PostErrorType.PUBLISH_REJECTED],
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
        expect(mockedAxios.put).not.toHaveBeenCalled();
      });
    });
  });

  describe("constructor", () => {
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
