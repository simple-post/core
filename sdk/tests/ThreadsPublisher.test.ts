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

  it("does not read status again when token refresh exhausts the processing deadline", async () => {
    jest.useFakeTimers();
    try {
      mockAxiosInstance.get.mockRejectedValueOnce({ response: { status: 401 } });
      mockedAxios.get.mockReset().mockImplementationOnce(async () => {
        jest.setSystemTime(Date.now() + 120_000);
        return { data: { access_token: "refreshed", expires_in: 3600 } };
      });
      const wait = (publisher as unknown as { waitForMediaReady(id: string): Promise<void> }).waitForMediaReady(
        "container",
      );
      await expect(wait).rejects.toMatchObject({ errorType: PostErrorType.PREPARATION_ERROR });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
      ).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        message: expect.stringContaining("creation failed"),
        details: { stage: "wait_child", childIndex: 0, childContainerIds: ["failed-child"], status: "ERROR" },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["create_child", 1, ["child-0"], undefined, 1, PostErrorType.PREPARATION_ERROR],
      ["create_parent", 2, ["child-0", "child-1"], undefined, undefined, PostErrorType.PREPARATION_ERROR],
      ["publish", 3, ["child-0", "child-1"], "parent", undefined, PostErrorType.API_ERROR],
    ] as const)(
      "retains safe Meta diagnostics for %s failures without retrying",
      async (stage, successes, children, parent, childIndex, errorType) => {
        const providerError = {
          code: 100,
          error_subcode: 2_207_009,
          type: "OAuthException",
          message: "Invalid parameter",
        };
        mockAxiosInstance.get.mockResolvedValue({ data: { id: "user_123", status: "FINISHED" } });
        for (const id of ["child-0", "child-1", "parent"].slice(0, successes)) {
          mockAxiosInstance.post.mockResolvedValueOnce({ data: { id } });
        }
        mockAxiosInstance.post.mockRejectedValueOnce({
          response: { status: 400, data: { error: providerError, access_token: "SECRET" } },
          config: { data: { access_token: "SECRET" } },
          request: { url: "https://example.com/?access_token=SECRET" },
        });
        const result = await publisher.post({
          media: [
            { type: "image", url: "https://cdn.example.com/one.jpg" },
            { type: "image", url: "https://cdn.example.com/two.jpg" },
          ],
        });
        // Before threads_publish nothing can have been published, so the rejection is a safe preparation failure.
        expect(result).toMatchObject({
          error: errorType,
          message: "Failed to post to Threads: Invalid parameter",
          details: { stage, childContainerIds: children, httpStatus: 400, error: providerError },
        });
        expect((result.details as any).parentContainerId).toBe(parent);
        expect((result.details as any).childIndex).toBe(childIndex);
        expect(JSON.stringify(result)).not.toMatch(/SECRET|config|request/);
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(successes + 1);
      },
    );

    it("preserves a thrown PostError's type and useful details while sanitizing context", async () => {
      mockSuccessfulGetSequence();
      const original = new PostError(PostErrorType.API_ERROR, "Invalid parameter", {
        error: {
          code: 100,
          error_subcode: 33,
          message:
            "Failed https://user:SECRET@example.com/?token=SECRET test_access_token Authorization: Bearer SECRET",
        },
        status: "ERROR",
        config: { headers: { Authorization: "SECRET" } },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "parent" } }).mockRejectedValueOnce(original);
      await expect(publisher.postContent({ text: "No duplicate" })).rejects.toMatchObject({
        errorType: original.errorType,
        message: original.message,
        details: {
          stage: "publish",
          parentContainerId: "parent",
          status: "ERROR",
          error: {
            code: 100,
            error_subcode: 33,
            message: "Failed [redacted URL] [redacted] Authorization: [redacted]",
          },
        },
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(original.details).toHaveProperty("config");
    });

    it("identifies media resolution failures before any containers are created", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } });
      const resolve = jest
        .spyOn(publisher as any, "resolveMedia")
        .mockRejectedValueOnce(
          new PostError(PostErrorType.PREPARATION_ERROR, "Media resolution failed", "Download failed"),
        );
      await expect(
        publisher.postContent({ media: [{ type: "image", url: "https://cdn.example.com/one.jpg" }] }),
      ).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        message: "Media resolution failed",
        details: { stage: "resolve_media", childContainerIds: [], detail: "Download failed" },
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      resolve.mockRestore();
    });

    it("reclassifies an S3 staging API error before publishing as a retryable preparation error", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } });
      const uploader = (publisher as any).getS3Uploader();
      uploader.uploadFile.mockRejectedValueOnce(
        new PostError(PostErrorType.API_ERROR, "Error uploading file to S3: access denied", { name: "AccessDenied" }),
      );
      await expect(publisher.postContent({ media: [{ type: "video", path: "./video.mp4" }] })).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        message: "Error uploading file to S3: access denied",
        details: { stage: "resolve_media", childContainerIds: [] },
      });
      expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it("identifies parent processing failures with the original processing status", async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValueOnce({ data: { status: "ERROR" } });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "parent" } });
      await expect(publisher.postContent({ text: "Processing" })).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        details: { stage: "wait_parent", parentContainerId: "parent", status: "ERROR" },
      });
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
    it("retries the same ready container when publishing reports it is not visible yet", async () => {
      jest.useFakeTimers();
      mockSuccessfulGetSequence();
      const rejection = { response: { status: 400, data: { error: { code: 24, error_subcode: 4_279_009 } } } };
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockRejectedValueOnce(rejection)
        .mockRejectedValueOnce(rejection)
        .mockRejectedValueOnce(rejection)
        .mockResolvedValueOnce({ data: { id: "post_456" } });
      try {
        const started = Date.now();
        const result = publisher.postContent({ text: "Ready before propagation" });
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "post_456", error: PostErrorType.NO_ERROR });
        expect(Date.now() - started).toBe(35_000);
        expect(mockAxiosInstance.post.mock.calls.filter(([url]: [string]) => url.endsWith("/threads"))).toHaveLength(1);
        const publishes = mockAxiosInstance.post.mock.calls.filter(([url]: [string]) =>
          url.endsWith("/threads_publish"),
        );
        expect(publishes).toHaveLength(4);
        for (const [, payload] of publishes) expect(payload.creation_id).toBe("creation_123");
      } finally {
        jest.useRealTimers();
      }
    });

    it("returns a conclusive retryable rejection when container propagation retries are exhausted", async () => {
      jest.useFakeTimers();
      mockSuccessfulGetSequence();
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockRejectedValue({ response: { status: 400, data: { error: { code: 24, error_subcode: 4_279_009 } } } });
      try {
        const result = expect(publisher.postContent({ text: "Still unavailable" })).rejects.toMatchObject({
          errorType: PostErrorType.PUBLISH_REJECTED,
          message: expect.stringContaining("retry the failed Threads target"),
          details: {
            stage: "publish",
            parentContainerId: "creation_123",
            httpStatus: 400,
            provider: { error: { code: 24, error_subcode: 4_279_009 } },
          },
        });
        await jest.runAllTimersAsync();
        await result;
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(5);
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([
      { message: "timeout", code: "ECONNABORTED" },
      { response: { status: 500, data: { error: { code: 24, error_subcode: 4_279_009 } } } },
      { response: { status: 503 } },
      { response: { status: 429, data: { error: { code: 4, is_transient: true } } } },
      { response: { status: 400, data: { error: { code: 24, error_subcode: 999 } } } },
      { response: { status: 400, data: { error: { code: 999, error_subcode: 4_279_009 } } } },
    ])("does not retry ambiguous or unrelated publish errors: %j", async (error) => {
      mockSuccessfulGetSequence();
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "creation_123" } }).mockRejectedValueOnce(error);
      await expect(publisher.postContent({ text: "No duplicate" })).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it("stops if a propagation rejection is followed by an ambiguous failure", async () => {
      jest.useFakeTimers();
      mockSuccessfulGetSequence();
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "creation_123" } })
        .mockRejectedValueOnce({ response: { status: 400, data: { error: { code: 24, error_subcode: 4_279_009 } } } })
        .mockRejectedValueOnce(new Error("Connection dropped after publish"));
      try {
        const result = expect(publisher.postContent({ text: "No duplicate" })).rejects.toMatchObject({
          errorType: PostErrorType.API_ERROR,
        });
        await jest.runAllTimersAsync();
        await result;
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
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

  describe("video reliability", () => {
    const video: Content = { text: "Video", media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }] };
    const calls = (suffix: string) =>
      mockAxiosInstance.post.mock.calls.filter(([url]: [string]) => url.endsWith(suffix));
    const statusReads = () =>
      mockAxiosInstance.get.mock.calls.filter(([, config]: [string, any]) => config?.params?.fields === "status");

    it("retries a transient container creation failure and publishes exactly once", async () => {
      jest.useFakeTimers();
      mockSuccessfulGetSequence("post_video");
      mockAxiosInstance.post
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockRejectedValueOnce({ response: { status: 500, data: { error: { code: 2, is_transient: true } } } })
        .mockResolvedValueOnce({ data: { id: "container" } })
        .mockResolvedValueOnce({ data: { id: "post_video" } });
      try {
        const started = Date.now();
        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "post_video", error: PostErrorType.NO_ERROR });
        expect(Date.now() - started).toBe(4000);
        expect(calls("/threads")).toHaveLength(3);
        for (const [, payload] of calls("/threads")) expect(payload).toMatchObject({ video_url: video.media![0].url });
        expect(calls("/threads_publish")).toHaveLength(1);
        expect(calls("/threads_publish")[0][1]).toMatchObject({ creation_id: "container" });
      } finally {
        jest.useRealTimers();
      }
    });

    it("re-reads the same container after a transient status failure without creating another", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockRejectedValueOnce({ code: "ECONNRESET" })
        .mockResolvedValueOnce({ data: { status: "IN_PROGRESS" } })
        .mockRejectedValueOnce({ response: { status: 502 } })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { id: "post_video", permalink: "https://www.threads.net/@test/post/video" } });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container" } })
        .mockResolvedValueOnce({ data: { id: "post_video" } });
      try {
        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "post_video", error: PostErrorType.NO_ERROR });
        expect(calls("/threads")).toHaveLength(1);
        expect(calls("/threads_publish")).toHaveLength(1);
        expect(statusReads()).toHaveLength(4);
        for (const [url] of statusReads()) expect(url).toBe("/container");
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps polling a container that is not queryable yet", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: { error: { code: 24, error_subcode: 4_279_009, message: "The requested resource does not exist" } },
          },
        })
        .mockResolvedValueOnce({ data: { status: "FINISHED" } })
        .mockResolvedValueOnce({ data: { id: "post_video", permalink: "https://www.threads.net/@test/post/video" } });
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container" } })
        .mockResolvedValueOnce({ data: { id: "post_video" } });
      try {
        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();
        expect(await result).toMatchObject({ id: "post_video", error: PostErrorType.NO_ERROR });
        expect(calls("/threads")).toHaveLength(1);
        expect(calls("/threads_publish")).toHaveLength(1);
        expect(statusReads()).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("stops polling immediately on a permanent status failure", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } }).mockRejectedValue({
        config: { params: { access_token: "SECRET" } },
        response: {
          status: 403,
          data: { error: { code: 10, type: "OAuthException", message: "Application does not have permission" } },
        },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      const result = await publisher.post(video);
      expect(result).toMatchObject({
        error: PostErrorType.PREPARATION_ERROR,
        message: "Failed to post to Threads: Application does not have permission",
        details: { stage: "wait_parent", parentContainerId: "container", httpStatus: 403, error: { code: 10 } },
      });
      expect(JSON.stringify(result)).not.toMatch(/SECRET|"config"/);
      expect(statusReads()).toHaveLength(1);
      expect(calls("/threads_publish")).toHaveLength(0);
    });

    it("does not keep polling on a message-only 400 that lacks the documented not-visible codes", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } }).mockRejectedValue({
        response: {
          status: 400,
          data: { error: { code: 100, message: "The requested resource does not exist" } },
        },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      await expect(publisher.postContent(video)).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        details: { stage: "wait_parent", parentContainerId: "container", httpStatus: 400, error: { code: 100 } },
      });
      expect(statusReads()).toHaveLength(1);
      expect(calls("/threads_publish")).toHaveLength(0);
    });

    it("stops polling immediately when the session is revoked", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } }).mockRejectedValue({
        response: {
          status: 401,
          data: { error: { code: 190, error_subcode: 458, message: "The user has not authorized application 1." } },
        },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      await expect(publisher.postContent(video)).rejects.toMatchObject({ errorType: PostErrorType.CREDENTIALS_ERROR });
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(statusReads()).toHaveLength(1);
      expect(calls("/threads_publish")).toHaveLength(0);
    });

    it("fails fast on an expired container without publishing", async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValue({ data: { status: "EXPIRED" } });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      await expect(publisher.postContent(video)).rejects.toMatchObject({
        errorType: PostErrorType.PREPARATION_ERROR,
        details: { stage: "wait_parent", parentContainerId: "container", status: "EXPIRED" },
      });
      expect(statusReads()).toHaveLength(1);
      expect(calls("/threads_publish")).toHaveLength(0);
    });

    it("gives up after the processing deadline without publishing", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockResolvedValue({ data: { status: "IN_PROGRESS" } });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      try {
        const started = Date.now();
        const result = expect(publisher.postContent(video)).rejects.toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: "Threads media processing timed out.",
          details: { stage: "wait_parent", parentContainerId: "container" },
        });
        await jest.runAllTimersAsync();
        await result;
        expect(Date.now() - started).toBe(2 * 60_000);
        expect(calls("/threads")).toHaveLength(1);
        expect(calls("/threads_publish")).toHaveLength(0);
        // Each status read's HTTP timeout is capped at 30 seconds and never outlives the deadline.
        expect(statusReads()[0][1].timeout).toBe(30_000);
        expect(statusReads().at(-1)[1].timeout).toBe(2000);
      } finally {
        jest.useRealTimers();
      }
    });

    it("bounds transient status retries instead of polling forever", async () => {
      jest.useFakeTimers();
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: "user_123" } })
        .mockRejectedValue({ response: { status: 503 } });
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "container" } });
      try {
        const result = expect(publisher.postContent(video)).rejects.toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          details: { stage: "wait_parent", parentContainerId: "container", httpStatus: 503 },
        });
        await jest.runAllTimersAsync();
        await result;
        expect(statusReads()).toHaveLength(3);
        expect(calls("/threads_publish")).toHaveLength(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps a transient failure of the final publish as an uncertain API error", async () => {
      mockSuccessfulGetSequence("post_video");
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: "container" } })
        .mockRejectedValueOnce({ message: "timeout of 30000ms exceeded", code: "ECONNABORTED" });
      await expect(publisher.postContent(video)).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
        details: { stage: "publish", parentContainerId: "container" },
      });
      expect(calls("/threads_publish")).toHaveLength(1);
    });
  });

  describe("credential revocation", () => {
    const revoked = {
      message: "request access_token=DO_NOT_STORE",
      config: { params: { access_token: "DO_NOT_STORE" } },
      response: {
        status: 401,
        data: { error: { code: 190, error_subcode: 458, message: "The user has not authorized application 123." } },
      },
    };
    const expectRevoked = (result: unknown) =>
      expect(result).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "Threads invalidated this connection. Reconnect the account before publishing.",
        details: [
          expect.objectContaining({
            platform: "threads",
            credentialRejection: { reason: "authorization_removed", code: 190, status: 401, subcode: 458 },
          }),
        ],
      });

    it("stops at the account lookup without attempting a token refresh", async () => {
      const logError = jest.spyOn(publisher.logger, "error");
      mockAxiosInstance.get.mockRejectedValueOnce(revoked);
      const result = await publisher.post({ text: "Hello" });
      expectRevoked(result);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("DO_NOT_STORE");
    });

    it("preserves revocation when creating the container", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: "user_123" } });
      mockAxiosInstance.post.mockRejectedValueOnce(revoked);
      const result = await publisher.post({ text: "Hello" });
      expectRevoked(result);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it("retains revocation returned by a proactive token refresh", async () => {
      publisher = new ThreadsPublisher({
        threads: {
          credentials: {
            accessToken: "old_access_token",
            userId: "user_123",
            expiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        },
      });
      const logError = jest.spyOn(publisher.logger, "error");
      mockedAxios.get.mockRejectedValueOnce(revoked);
      expectRevoked(await publisher.post({ text: "Hello" }));
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it("sanitizes a revoked response from the single retry after an ordinary expiry", async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce({
          response: { status: 401, data: { error: { code: 190, message: "Session has expired." } } },
        })
        .mockRejectedValueOnce(revoked);
      mockedAxios.get.mockResolvedValueOnce({
        data: { access_token: "retry_access_token", token_type: "bearer", expires_in: 5_184_000 },
      });
      const result = await publisher.post({ text: "Hello" });
      expectRevoked(result);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("DO_NOT_STORE");
    });

    it("preserves revocation when reposting", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce(revoked);
      expectRevoked(await publisher.repost({ postId: "source_thread" }));
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(ThreadsPublisher.prototype, "validateReadiness").mockResolvedValue([]));
