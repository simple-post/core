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

  const mockSuccessfulGetSequence = (postId = "post_456") => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { id: "user_123" } })
      .mockResolvedValueOnce({ data: { status: "FINISHED" } })
      .mockResolvedValueOnce({ data: { id: postId, permalink: `https://threads.net/@simplepost/post/${postId}` } });
  };

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
      mockSuccessfulGetSequence();

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
      mockSuccessfulGetSequence("post_video");

      const content: Content = {
        text: "Video post",
        media: [{ type: "video", path: "./video.mp4" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockAxiosInstance.get).toHaveBeenCalled();
    });

    it("should proactively refresh tokens that are near expiry", async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      publisher = new ThreadsPublisher({
        threads: {
          credentials: {
            accessToken: "old_access_token",
            userId: "user_123",
            expiresAt,
          },
        },
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: { access_token: "new_access_token", token_type: "bearer", expires_in: 5_184_000 },
      });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockResolvedValueOnce({ data: { id: "post_456" } });
      mockSuccessfulGetSequence();

      const result = await publisher.postContent({ text: "Hello with fresh token" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("https://graph.threads.net/refresh_access_token"),
      );
      expect(mockAxiosInstance.post.mock.calls[0][1]).toMatchObject({
        access_token: "new_access_token",
      });
      expect(result.extraData?.refreshedCredentials).toMatchObject({
        accessToken: "new_access_token",
        expiresAt: expect.any(Number),
      });
    });

    it("should refresh and retry when the API reports an expired token", async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce({
          response: {
            status: 401,
            data: { error: { code: 190, message: "Error validating access token: Session has expired." } },
          },
          message: "Request failed",
        })
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({
          data: { id: "post_456", permalink: "https://threads.net/@simplepost/post/post_456" },
        });
      mockedAxios.get.mockResolvedValueOnce({
        data: { access_token: "retry_access_token", token_type: "bearer", expires_in: 5_184_000 },
      });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockResolvedValueOnce({ data: { id: "post_456" } });

      const result = await publisher.postContent({ text: "Hello after retry" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get.mock.calls[1][1].params.access_token).toBe("retry_access_token");
      expect(mockAxiosInstance.post.mock.calls[0][1]).toMatchObject({
        access_token: "retry_access_token",
      });
      expect(result.extraData?.refreshedCredentials?.accessToken).toBe("retry_access_token");
    });

    it("should pass the source post id when creating a native quote", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_quote" } })
        .mockResolvedValueOnce({ data: { id: "post_quote" } });
      mockSuccessfulGetSequence("post_quote");

      const result = await publisher.quote({ text: "My take" }, { postId: "source_thread" });

      expect(mockAxiosInstance.post.mock.calls[0][1]).toMatchObject({
        text: "My take",
        media_type: "TEXT",
        quote_post_id: "source_thread",
      });
      expect(result).toMatchObject({ id: "post_quote", error: PostErrorType.NO_ERROR });
    });
  });
});
