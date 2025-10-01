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
    uploadFile: jest.fn(),
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
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            publish_id: "publish_123",
            upload_url: "https://upload.tiktok.com/video?upload_id=123",
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

      const result = await publisher.postContent(videoContent);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("publish_123");
      // Direct Post API only requires 1 POST (init) - no complete or publish steps
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
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
    });

    it("should successfully post a photo", async () => {
      // Mock the Direct Post API init response for photos
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            publish_id: "publish_456",
            upload_url: "https://upload.tiktok.com/photo?upload_id=456",
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

      const result = await publisher.postContent(photoContent);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("publish_456");
      // Direct Post API only requires 1 POST (init)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      // Verify photo endpoint is used
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/photo/init/",
        expect.objectContaining({
          post_info: expect.any(Object),
          source_info: expect.any(Object),
        }),
      );
    });

    it("should handle different visibility settings", async () => {
      // Mock the Direct Post API response
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            publish_id: "publish_789",
            upload_url: "https://upload.tiktok.com/video?upload_id=789",
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
      expect(result.id).toBe("publish_789");

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
      expect(result.id).toBe("draft_uploaded");

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

    it("should warn about multiple media items", async () => {
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
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            publish_id: "publish_multi",
            upload_url: "https://upload.tiktok.com/photo?upload_id=multi",
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

      const result = await strictPublisher.postContent(contentWithMultipleMedia);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      // Direct Post API - should only have 1 POST call (init)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
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
    it("should validate caption length", async () => {
      const longCaption = "a".repeat(200); // Exceeds 150 character limit
      const contentWithLongCaption: Content = {
        text: longCaption,
        media: [{ type: "video", path: "./test-video.mp4" }],
      };

      // Create publisher in strict mode
      const strictPublisher = new TikTokPublisher({
        common: { strictMode: false },
        tiktok: {
          credentials: {
            accessToken: "test_access_token",
          },
        },
      });

      // Should not throw but may warn
      await expect(async () => {
        // Mock successful response using Direct Post API
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_long",
              upload_url: "https://upload.tiktok.com/video?upload_id=long",
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

        await strictPublisher.postContent(contentWithLongCaption);
      }).not.toThrow();
    });
  });
});
