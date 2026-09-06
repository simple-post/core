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
    it("publishes every image and video in order in one carousel, with text and reply on the parent", async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { permalink: "https://www.threads.net/@test/post/carousel" } });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "image-child" } })
        .mockResolvedValueOnce({ data: { id: "video-child" } })
        .mockResolvedValueOnce({ data: { id: "parent" } })
        .mockResolvedValueOnce({ data: { id: "published" } });
      const result = await publisher.postContent(
        {
          text: "Carousel caption",
          media: [
            { type: "image", url: "https://cdn.example.com/one.jpg" },
            { type: "video", url: "https://cdn.example.com/two.mp4" },
          ],
        },
        {
          threads: { replyToId: "reply-source", credentials: { accessToken: "test_access_token", userId: "user_123" } },
        },
      );
      expect(result.id).toBe("published");
      expect(mockAxiosInstance.post.mock.calls[0][1]).toMatchObject({
        media_type: "IMAGE",
        image_url: "https://cdn.example.com/one.jpg",
        is_carousel_item: true,
      });
      expect(mockAxiosInstance.post.mock.calls[1][1]).toMatchObject({
        media_type: "VIDEO",
        video_url: "https://cdn.example.com/two.mp4",
        is_carousel_item: true,
      });
      expect(mockAxiosInstance.post.mock.calls[0][1]).not.toHaveProperty("reply_to_id");
      expect(mockAxiosInstance.post.mock.calls[2][1]).toMatchObject({
        media_type: "CAROUSEL",
        children: "image-child,video-child",
        text: "Carousel caption",
        reply_to_id: "reply-source",
      });
      expect(mockAxiosInstance.post.mock.calls[3][1]).toMatchObject({ creation_id: "parent" });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(4);
    });

    it("does not publish a partial carousel when a child fails processing", async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValueOnce({ data: { status: "ERROR" } });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "failed-child" } });
      await expect(
        publisher.postContent({
          media: [
            { type: "image", url: "https://cdn.example.com/one.jpg" },
            { type: "image", url: "https://cdn.example.com/two.jpg" },
          ],
        }),
      ).rejects.toThrow("creation failed");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it("accepts 20 carousel items and rejects 21 before making provider calls", async () => {
      const media = Array.from({ length: 20 }, (_, i) => ({
        type: "image" as const,
        url: `https://cdn.example.com/${i}.jpg`,
      }));
      expect(ThreadsPublisher.validate({ media }).isValid).toBe(true);
      await expect(publisher.postContent({ media: [...media, media[0]] })).rejects.toThrow("validation failed");
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it("waits longer than the old 24-second limit without creating duplicate containers", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } });
      for (let i = 0; i < 20; i += 1) mockAxiosInstance.get.mockResolvedValueOnce({ data: { status: "IN_PROGRESS" } });
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { permalink: "https://www.threads.net/@test/post/video" } });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container" } })
        .mockResolvedValueOnce({ data: { id: "video" } });
      try {
        const result = publisher.postContent({
          text: "Slow video",
          media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
        });
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "video", error: PostErrorType.NO_ERROR });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
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
        { timeout: 30_000 },
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
