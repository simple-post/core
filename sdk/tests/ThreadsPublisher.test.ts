import axios from "axios";

import { ThreadsPublisher } from "../src/publishers/threads";
import { PostError, PostErrorType } from "../src/types";

import type { Content } from "../src/types/post";

jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://cdn.example.com/media.jpg"),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ThreadsPublisher", () => {
  let publisher: ThreadsPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    publisher = new ThreadsPublisher({
      threads: {
        credentials: {
          accessToken: "test_access_token",
          userId: "user_123",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new ThreadsPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("should post an image successfully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockResolvedValueOnce({ data: { id: "post_456" } });

      const content: Content = {
        text: "Hello Threads!",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("post_456");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it("should wait for video processing before publish", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_video" } })
        .mockResolvedValueOnce({ data: { id: "post_video" } });
      mockAxiosInstance.get.mockResolvedValue({ data: { status: "FINISHED" } });

      const content: Content = {
        text: "Video post",
        media: [{ type: "video", path: "./video.mp4" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockAxiosInstance.get).toHaveBeenCalled();
    });
  });
});
