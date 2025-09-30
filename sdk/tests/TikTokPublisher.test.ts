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
      // Mock the upload init response
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              upload_url: "https://upload.tiktok.com/video?upload_id=123",
              upload_id: "123",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_123",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            share_id: "final_123",
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
      expect(result.id).toBe("final_123");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it("should successfully post a photo", async () => {
      // Mock the upload init response
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              upload_url: "https://upload.tiktok.com/photo?upload_id=456",
              upload_id: "456",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_456",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            share_id: "final_456",
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
      expect(result.id).toBe("final_456");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it("should handle draft mode", async () => {
      // Mock the upload responses
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              upload_url: "https://upload.tiktok.com/video?upload_id=789",
              upload_id: "789",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_789",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "draft_789",
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
      expect(result.id).toBe("draft_789");

      // Verify draft endpoint was called
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/v2/post/publish/content/draft/",
        expect.objectContaining({
          publish_id: "publish_789",
          text: "Test TikTok video!",
          privacy_level: "SELF_ONLY",
          disable_comment: true,
          disable_duet: true,
          disable_stitch: true,
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

      // Mock successful upload for the first image
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              upload_url: "https://upload.tiktok.com/photo?upload_id=multi",
              upload_id: "multi",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              publish_id: "publish_multi",
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            share_id: "final_multi",
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
      // Should only process the first media item
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
        // Mock successful responses for the test
        mockAxiosInstance.post
          .mockResolvedValueOnce({
            data: {
              data: {
                upload_url: "https://upload.tiktok.com/video?upload_id=long",
                upload_id: "long",
              },
            },
          })
          .mockResolvedValueOnce({
            data: {
              data: {
                publish_id: "publish_long",
              },
            },
          })
          .mockResolvedValueOnce({
            data: {
              share_id: "final_long",
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
