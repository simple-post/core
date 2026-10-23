import fs from "node:fs";
import { Readable } from "node:stream";

import axios from "axios";

import { LinkedInPublisher } from "../src/publishers/linkedin";
import { PostError, PostErrorType } from "../src/types";

import type { Content } from "../src/types/post";

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

describe("LinkedInPublisher", () => {
  let publisher: LinkedInPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    mockedAxios.put.mockResolvedValue({ status: 201 });

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.createReadStream.mockImplementation(() => Readable.from([Buffer.from("file")]) as fs.ReadStream);

    publisher = new LinkedInPublisher({
      linkedin: {
        credentials: {
          accessToken: "test_access_token",
          memberId: "member_123",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new LinkedInPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("allows retry after a media registration failure before publishing", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce(new Error("502 registration failed"));
      await expect(
        publisher.postContent({ text: "Hello", media: [{ type: "image", path: "./image.jpg" }] }),
      ).rejects.toMatchObject({ errorType: PostErrorType.PREPARATION_ERROR });
      expect(mockAxiosInstance.post).not.toHaveBeenCalledWith("/ugcPosts", expect.anything());
    });
    it("keeps a 502 from the actual publish request ambiguous", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce(new Error("502 publish failed"));
      await expect(publisher.postContent({ text: "Hello" })).rejects.toMatchObject({
        errorType: PostErrorType.API_ERROR,
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
    it("should post an image successfully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            value: {
              asset: "urn:li:digitalmediaAsset:123",
              uploadMechanism: {
                "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
                  uploadUrl: "https://upload.linkedin.com/file",
                },
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: { id: "urn:li:ugcPost:456" },
          headers: {},
        });

      const content: Content = {
        text: "Hello LinkedIn!",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("urn:li:ugcPost:456");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockedAxios.put).toHaveBeenCalled();
    });

    describe("video preparation recovery", () => {
      const video: Content = { text: "Video", media: [{ type: "video", path: "./video.mp4", title: "Demo" }] };
      const registration = {
        data: {
          value: {
            asset: "urn:li:digitalmediaAsset:C5F10AQ-video",
            uploadMechanism: {
              "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
                uploadUrl: "https://upload.linkedin.com/signed?sig=SECRET",
              },
            },
          },
        },
      };
      const recipe = (status: string, assetStatus?: string) => ({
        data: {
          ...(assetStatus && { status: assetStatus }),
          recipes: [
            { recipe: "urn:li:digitalmediaRecipe:feedshare-image", status: "AVAILABLE" },
            { recipe: "urn:li:digitalmediaRecipe:feedshare-video", status },
          ],
        },
      });
      const published = { data: { id: "urn:li:ugcPost:video" }, headers: {} };
      const ugcPostCalls = () => mockAxiosInstance.post.mock.calls.filter((call: unknown[]) => call[0] === "/ugcPosts");

      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it("publishes once only after the video recipe becomes AVAILABLE", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration).mockResolvedValueOnce(published);
        mockAxiosInstance.get
          .mockResolvedValueOnce(recipe("NEW", "ALLOWED"))
          .mockResolvedValueOnce(recipe("WAITING_UPLOAD", "ALLOWED"))
          .mockResolvedValueOnce(recipe("PROCESSING", "ALLOWED"))
          .mockResolvedValueOnce(recipe("AVAILABLE", "ALLOWED"));

        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ id: "urn:li:ugcPost:video", error: PostErrorType.NO_ERROR });
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4);
        for (const [route, config] of mockAxiosInstance.get.mock.calls) {
          expect(route).toBe("/assets/C5F10AQ-video");
          expect(config.timeout).toBeGreaterThan(0);
          expect(config.timeout).toBeLessThanOrEqual(30_000);
        }
        expect(ugcPostCalls()).toHaveLength(1);
        expect(ugcPostCalls()[0][1].specificContent["com.linkedin.ugc.ShareContent"].media[0].media).toBe(
          "urn:li:digitalmediaAsset:C5F10AQ-video",
        );
      });

      it("retries transient registration and upload failures with a fresh stream", async () => {
        const streams: Readable[] = [];
        mockedFs.createReadStream.mockImplementation(() => {
          const stream = Readable.from([Buffer.from("video")]);
          streams.push(stream);
          return stream as fs.ReadStream;
        });
        mockAxiosInstance.post
          .mockRejectedValueOnce({ response: { status: 503, data: { message: "Unavailable" } } })
          .mockResolvedValueOnce(registration)
          .mockResolvedValueOnce(published);
        mockedAxios.put.mockRejectedValueOnce({ code: "ECONNRESET" }).mockResolvedValueOnce({ status: 201 });
        mockAxiosInstance.get.mockResolvedValue(recipe("AVAILABLE"));

        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ error: PostErrorType.NO_ERROR });
        expect(mockedAxios.put).toHaveBeenCalledTimes(2);
        expect(streams).toHaveLength(2);
        expect(mockedAxios.put.mock.calls[1][1]).toBe(streams[1]);
        expect(streams.every((stream) => stream.destroyed)).toBe(true);
        // The retried PUT gets only the remaining budget, not a fresh full window.
        expect(mockedAxios.put.mock.calls[0][2]!.timeout!).toBeLessThanOrEqual(600_000);
        expect(mockedAxios.put.mock.calls[1][2]!.timeout!).toBeLessThan(mockedAxios.put.mock.calls[0][2]!.timeout!);
        expect(ugcPostCalls()).toHaveLength(1);
      });

      const imageOnly = {
        data: { recipes: [{ recipe: "urn:li:digitalmediaRecipe:feedshare-image", status: "AVAILABLE" }] },
      };
      it.each([
        ["only an image recipe is AVAILABLE", imageOnly, PostErrorType.PREPARATION_ERROR],
        ["the asset is BLOCKED", recipe("AVAILABLE", "BLOCKED"), PostErrorType.INVALID_CONTENT],
        ["the asset is DELETED", recipe("PROCESSING", "DELETED"), PostErrorType.PREPARATION_ERROR],
        ["the asset is ABANDONED", recipe("AVAILABLE", "ABANDONED"), PostErrorType.PREPARATION_ERROR],
      ])("never publishes when %s", async (_label, statusResponse, errorType) => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration);
        mockAxiosInstance.get.mockResolvedValue(statusResponse);

        const outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({ errorType, details: { stage: "processing" } });
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
        expect(ugcPostCalls()).toHaveLength(0);
      });

      it("retries a transient status read for the same asset", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration).mockResolvedValueOnce(published);
        mockAxiosInstance.get
          .mockRejectedValueOnce({ response: { status: 502 } })
          .mockResolvedValueOnce(recipe("AVAILABLE"));

        const result = publisher.postContent(video);
        await jest.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ error: PostErrorType.NO_ERROR });
        expect(mockAxiosInstance.get.mock.calls.map((call: unknown[]) => call[0])).toEqual([
          "/assets/C5F10AQ-video",
          "/assets/C5F10AQ-video",
        ]);
        expect(ugcPostCalls()).toHaveLength(1);
      });

      it.each([
        ["CLIENT_ERROR", PostErrorType.INVALID_CONTENT],
        ["SERVER_ERROR", PostErrorType.PREPARATION_ERROR],
        ["INCOMPLETE", PostErrorType.PREPARATION_ERROR],
      ])("never publishes when the recipe ends in %s", async (status, errorType) => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration);
        mockAxiosInstance.get.mockResolvedValue(recipe(status));

        const outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({ errorType, details: { stage: "processing", status } });
        expect(ugcPostCalls()).toHaveLength(0);
      });

      it("never publishes when processing is still unconfirmed at the deadline", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration);
        mockAxiosInstance.get.mockResolvedValue(recipe("PROCESSING"));

        const outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: expect.stringContaining("within 3 minutes"),
        });
        expect(mockAxiosInstance.get.mock.calls.length).toBeLessThanOrEqual(61);
        expect(ugcPostCalls()).toHaveLength(0);
      });

      it("keeps unconfirmed status reads bounded and reports only allowlisted details", async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(registration);
        mockAxiosInstance.get.mockRejectedValue({
          message: "Bearer test_access_token",
          config: { url: "https://upload.linkedin.com/signed?sig=SECRET" },
          response: { status: 503 },
        });

        const outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          details: { stage: "processing", assetId: "C5F10AQ-video", httpStatus: 503 },
        });
        expect(JSON.stringify(await outcome)).not.toContain("SECRET");
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
        expect(ugcPostCalls()).toHaveLength(0);
      });

      it("fails fast on credential rejection and after bounded registration attempts", async () => {
        mockAxiosInstance.post.mockRejectedValue({ response: { status: 401, data: { message: "Expired" } } });
        let outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();
        expect(await outcome).toMatchObject({ errorType: PostErrorType.CREDENTIALS_ERROR });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

        mockAxiosInstance.post
          .mockReset()
          .mockRejectedValue({ message: "Bearer SECRET", response: { status: 503, data: { message: "SECRET" } } });
        outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();
        expect(await outcome).toMatchObject({
          errorType: PostErrorType.PREPARATION_ERROR,
          message: "LinkedIn did not register the media upload. No post was created; retry the post.",
          details: { stage: "register", httpStatus: 503 },
        });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
        expect(mockedAxios.put).not.toHaveBeenCalled();
      });

      it("never resubmits ugcPosts after an ambiguous publish timeout", async () => {
        mockAxiosInstance.post
          .mockResolvedValueOnce(registration)
          .mockRejectedValueOnce({ code: "ECONNABORTED", message: "timeout of 30000ms exceeded" });
        mockAxiosInstance.get.mockResolvedValue(recipe("AVAILABLE"));

        const outcome = publisher.postContent(video).catch((error: unknown) => error);
        await jest.runAllTimersAsync();

        expect(await outcome).toMatchObject({ errorType: PostErrorType.API_ERROR });
        expect(ugcPostCalls()).toHaveLength(1);
      });
    });

    it("should create a reshare with commentary for a native quote", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: "urn:li:share:quote" },
        headers: {},
      });

      const result = await publisher.quote({ text: "My take" }, { postId: "urn:li:share:source" });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linkedin.com/rest/posts",
        expect.objectContaining({
          commentary: "My take",
          reshareContext: { parent: "urn:li:share:source" },
        }),
        expect.anything(),
      );
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "urn:li:share:quote", error: PostErrorType.NO_ERROR });
    });

    it("should reject new media instead of silently omitting it from a LinkedIn quote", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: "urn:li:share:quote-without-media" },
        headers: {},
      });

      const result = await publisher.quote(
        { text: "My take", media: [{ type: "image", path: "./image.jpg" }] },
        { postId: "urn:li:share:source" },
      );

      expect(result.error).toBe(PostErrorType.INVALID_CONTENT);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockedAxios.put).not.toHaveBeenCalled();
    });
  });
});

// Transport unit tests use synthetic paths. Real probes and the common send boundary
// are exercised in ValidationBoundary.test.ts and VideoInspection.test.ts.
jest.mock("../src/utils/post-media-validation", () => ({ validatePostMedia: async () => [] }));
beforeEach(() => jest.spyOn(LinkedInPublisher.prototype, "validateReadiness").mockResolvedValue([]));
