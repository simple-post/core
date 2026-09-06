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
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/media/media_123");
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

    it("should reject a video without a cover image before uploading", async () => {
      await expect(
        publisher.postContent(
          { media: [{ type: "video", path: "./video.mp4" }] },
          {
            pinterest: {
              boardId: "board_123",
              credentials: { accessToken: "test_access_token" },
            },
          },
        ),
      ).rejects.toThrow("thumbnailUrl");
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});
