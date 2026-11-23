import fs from "node:fs";
import { Readable } from "node:stream";

import axios from "axios";
import FormData from "form-data";

import { FacebookPublisher } from "../src/publishers/facebook";
import { PostError, PostErrorType } from "../src/types";
import { rememberDownloadedSource } from "../src/utils/resolved-media-source";
import { getKeyFromUrl } from "../src/utils/s3";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  getKeyFromUrl: jest.fn(),
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
      get: jest.fn().mockResolvedValue({ data: { status: { video_status: "ready" } } }),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ size: 10, mtimeMs: 1 } as fs.Stats);
    mockedFs.createReadStream.mockImplementation(() => Readable.from([Buffer.alloc(10)]) as fs.ReadStream);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock file content"));

    // Mock FormData
    const mockFormDataInstance = {
      append: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({ "content-type": "multipart/form-data; boundary=test" }),
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
        baseURL: "https://graph.facebook.com/v25.0",
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

      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { video_id: "video_id_123", upload_session_id: "session", start_offset: "0", end_offset: "10" },
        })
        .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "10" } })
        .mockResolvedValueOnce({ data: { success: true } });

      const result = await publisher.postContent(content, options);

      const finish = mockAxiosInstance.post.mock.calls[2][1] as URLSearchParams;
      expect(finish.get("description")).toBe("Check out this video!");
      expect(finish.get("title")).toBe("Test video");
      expect(finish.get("upload_phase")).toBe("finish");
      expect(mockedFs.readFileSync).not.toHaveBeenCalled();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: "video_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("Facebook content validation failed");
    });

    it("should accept text at the character limit (63,206 characters)", async () => {
      const textAtLimit = "a".repeat(63_206);
      const content: Content = {
        text: textAtLimit,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "post_at_limit_123" },
      });

      const result = await publisher.postContent(content, options);

      expect(result).toEqual({ id: "post_at_limit_123", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for text exceeding character limit", async () => {
      const textOverLimit = "a".repeat(63_207); // One character over the limit
      const content: Content = {
        text: textOverLimit,
      };

      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("Facebook content validation failed");
    });

    it("should accept text within character limit", async () => {
      const textWithinLimit = "a".repeat(1000);
      const content: Content = {
        text: textWithinLimit,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { id: "post_within_limit_123" },
      });

      const result = await publisher.postContent(content, options);

      expect(result).toEqual({ id: "post_within_limit_123", error: PostErrorType.NO_ERROR });
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

    it("should schedule a text post correctly", async () => {
      const scheduledTime = new Date(Date.now() + 86_400_000).toISOString();
      const content: Content = {
        text: "This is a scheduled post",
      };

      const optionsWithSchedule: PostOptionsWithCredentials = {
        facebook: {
          publishAt: scheduledTime,
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
          scheduled_publish_time: String(Math.floor(new Date(scheduledTime).getTime() / 1000)),
          published: false,
        }),
      );
      expect(result).toEqual({ id: "scheduled_post_123", error: PostErrorType.NO_ERROR });
    });

    it("should schedule a video post correctly", async () => {
      const scheduledTime = new Date(Date.now() + 86_400_000).toISOString();
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
          publishAt: scheduledTime,
          credentials: {
            pageAccessToken: "test_access_token",
            pageId: "test_page_id",
          },
        },
      };

      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { video_id: "scheduled_video_123", upload_session_id: "session", start_offset: "0", end_offset: "10" },
        })
        .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "10" } })
        .mockResolvedValueOnce({ data: { success: true } });

      const result = await publisher.postContent(content, optionsWithSchedule);

      const finish = mockAxiosInstance.post.mock.calls[2][1] as URLSearchParams;
      expect(finish.get("published")).toBe("false");
      expect(finish.get("scheduled_publish_time")).toBe(String(Math.floor(new Date(scheduledTime).getTime() / 1000)));

      expect(result).toEqual({ id: "scheduled_video_123", error: PostErrorType.NO_ERROR });
    });
  });

  describe("validate", () => {
    const options: PostOptionsWithCredentials = {
      facebook: {
        credentials: {
          pageAccessToken: "test_access_token",
          pageId: "test_page_id",
        },
      },
    };

    beforeEach(() => {
      publisher = new FacebookPublisher(options);
    });

    it("should reject when too many images are provided", () => {
      const content: Content = {
        text: "Too many images",
        media: Array.from({ length: 12 }, (_, index) => ({
          type: "image" as const,
          path: `/path/${index}.jpg`,
        })),
      };

      const result = FacebookPublisher.validate(content);

      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("too_many_images");
    });

    it("should error when video is mixed with images", () => {
      const content: Content = {
        text: "Mixed media",
        media: [
          { type: "video", path: "/path/video.mp4" },
          { type: "image", path: "/path/image.jpg" },
        ],
      };

      const result = FacebookPublisher.validate(content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("video_with_other_media");
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
        message: "Facebook content validation failed",
        details: expect.anything(),
      });
    });

    it("uses the managed URL after resolution and preserves HTTP 413 at the public SDK boundary", async () => {
      jest.mocked(getKeyFromUrl).mockReturnValue("uploads/user/video.mp4");
      const video = {
        type: "video" as const,
        path: "/tmp/video.mp4",
        url: "https://storage.example/uploads/user/video.mp4",
      };
      rememberDownloadedSource(video);
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 413, data: "" } });
      const result = await publisher.post({ media: [video] }, options);
      expect(result).toMatchObject({
        error: PostErrorType.PUBLISH_REJECTED,
        details: { stage: "url", httpStatus: 413 },
      });
      const params = mockAxiosInstance.post.mock.calls[0][1] as URLSearchParams;
      expect(params.get("file_url")).toBe(video.url);
      expect(mockedFs.createReadStream).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it("preserves an uncertain processing result without converting it into a credential retry", async () => {
      jest.mocked(getKeyFromUrl).mockReturnValue("uploads/user/video.mp4");
      const video = {
        type: "video" as const,
        path: "/tmp/video.mp4",
        url: "https://storage.example/uploads/user/video.mp4",
      };
      rememberDownloadedSource(video);
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "accepted_video" } });
      mockAxiosInstance.get.mockRejectedValueOnce({
        response: { status: 400, data: { error: { code: 190, error_subcode: 460 } } },
      });
      const result = await publisher.post({ media: [video] }, options);
      expect(result).toMatchObject({
        error: PostErrorType.API_ERROR,
        details: { stage: "processing", videoId: "accepted_video" },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("credential revocation", () => {
    const options: PostOptionsWithCredentials = {
      facebook: { credentials: { pageAccessToken: "test_access_token", pageId: "test_page_id" } },
    };
    const revoked = {
      message: "request access_token=DO_NOT_STORE",
      config: { data: "access_token=DO_NOT_STORE" },
      response: {
        status: 400,
        data: {
          error: { code: 190, error_subcode: 460, message: "The session has been invalidated.", fbtrace_id: "trace" },
        },
      },
    };

    it.each<[string, Content]>([
      ["feed", { text: "Hello" }],
      ["photo upload", { text: "Photo", media: [{ type: "image", path: "/path/to/image.jpg" }] }],
      ["video upload", { text: "Video", media: [{ type: "video", path: "/path/to/video.mp4", title: "Video" }] }],
    ])("preserves revocation during %s without logging the request", async (_stage, content) => {
      const logError = jest.spyOn(publisher.logger, "error");
      mockAxiosInstance.post.mockRejectedValueOnce(revoked);
      const result = await publisher.post(content, options);
      expect(result).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "Facebook invalidated this connection. Reconnect the account before publishing.",
        details: [
          expect.objectContaining({
            platform: "facebook",
            credentialRejection: { reason: "session_revoked", code: 190, status: 400, subcode: 460, traceId: "trace" },
          }),
        ],
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(logError).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("DO_NOT_STORE");
    });

    it("keeps ordinary Graph API failures as API errors", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 400, data: { error: { code: 100, message: "Invalid parameter" } } },
      });
      const result = await publisher.post({ text: "Hello" }, options);
      expect(result.error).toBe(PostErrorType.API_ERROR);
      expect(JSON.stringify(result)).not.toContain("credentialRejection");
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(FacebookPublisher.prototype, "validateReadiness").mockResolvedValue([]));
