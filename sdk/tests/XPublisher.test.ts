import fs from "node:fs";

import axios from "axios";
import { TwitterApi } from "twitter-api-v2";

import { XPublisher } from "../src/publishers/x";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("twitter-api-v2");
jest.mock("fs");
jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

const futureTimestamp = (): number => Math.floor(Date.now() / 1000) + 7200;
const nearExpiredTimestamp = (): number => Math.floor(Date.now() / 1000) + 30;

const validCredentialsOptions = (): PostOptionsWithCredentials => ({
  x: {
    credentials: {
      clientId: "test_client_id",
      clientSecret: "test_client_secret",
      accessToken: "test_access_token",
      refreshToken: "test_refresh_token",
      expiresAt: futureTimestamp(),
    },
  },
});

describe("XPublisher", () => {
  let publisher: XPublisher;
  let mockTwitterClient: any;
  let mockV2Client: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock-file-content"));

    mockV2Client = {
      tweet: jest.fn(),
      uploadMedia: jest.fn(),
    };

    mockTwitterClient = {
      v1: {},
      v2: mockV2Client,
    };

    MockedTwitterApi.mockImplementation(() => mockTwitterClient);
  });

  describe("constructor", () => {
    it("should throw when no credentials are provided", () => {
      expect(() => new XPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials"),
      );
    });

    it("should throw when neither accessToken nor (clientId + refreshToken) is provided", () => {
      expect(
        () =>
          new XPublisher({
            x: { credentials: { clientId: "only_client_id" } },
          }),
      ).toThrow(PostError);
    });

    it("should initialize with a cached access token", () => {
      new XPublisher(validCredentialsOptions());
      expect(MockedTwitterApi).toHaveBeenCalledWith("test_access_token");
    });

    it("should initialize with refresh-only credentials (no cached access token)", () => {
      new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            refreshToken: "test_refresh_token",
          },
        },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("");
    });
  });

  describe("postContent", () => {
    let options: PostOptionsWithCredentials;

    beforeEach(() => {
      options = validCredentialsOptions();
      publisher = new XPublisher(options);
    });

    it("should post text-only content successfully", async () => {
      const content: Content = { text: "Hello, X!" };
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_123" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("Hello, X!", {
        media: undefined,
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should post content with media successfully", async () => {
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };
      mockV2Client.uploadMedia.mockResolvedValue("media_id_123");
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_456" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.uploadMedia).toHaveBeenCalledWith(expect.any(Buffer), { media_type: "image/jpeg" });
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Check out this image!", {
        media: { media_ids: ["media_id_123"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_456", error: PostErrorType.NO_ERROR });
    });

    it("should post content with reply successfully", async () => {
      const content: Content = { text: "This is a reply" };
      const replyOptions: PostOptionsWithCredentials = {
        x: {
          replyToId: "original_tweet_id",
          credentials: validCredentialsOptions().x!.credentials,
        },
      };
      mockV2Client.tweet.mockResolvedValue({ data: { id: "reply_tweet_id_789" } });

      const result = await publisher.postContent(content, replyOptions);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("This is a reply", {
        media: undefined,
        reply: { in_reply_to_tweet_id: "original_tweet_id" },
      });
      expect(result).toEqual({ id: "reply_tweet_id_789", error: PostErrorType.NO_ERROR });
    });

    it("should handle multiple media files", async () => {
      const content: Content = {
        text: "Multiple images",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "image", path: "/path/to/image3.jpg" },
        ],
      };
      mockV2Client.uploadMedia
        .mockResolvedValueOnce("media_id_1")
        .mockResolvedValueOnce("media_id_2")
        .mockResolvedValueOnce("media_id_3");
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_multi" } });

      const result = await publisher.postContent(content, options);

      expect(mockV2Client.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Multiple images", {
        media: { media_ids: ["media_id_1", "media_id_2", "media_id_3"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_multi", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};
      await expect(publisher.postContent(content, options)).rejects.toThrow(PostError);
      await expect(publisher.postContent(content, options)).rejects.toThrow("X content validation failed");
    });

    it("should handle API errors during posting", async () => {
      const content: Content = { text: "This will fail" };
      mockV2Client.tweet.mockRejectedValue(new Error("API Error"));

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Failed to post content: Error: API Error", undefined),
      );
    });

    it("should create a native quote post", async () => {
      mockV2Client.tweet.mockResolvedValue({ data: { id: "quote_tweet_id" } });

      const result = await publisher.quote({ text: "My take" }, { postId: "original_tweet_id" }, options);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("My take", {
        media: undefined,
        reply: undefined,
        quote_tweet_id: "original_tweet_id",
      });
      expect(result).toEqual({ id: "quote_tweet_id", error: PostErrorType.NO_ERROR });
    });
  });

  describe("token refresh", () => {
    const expiredCredentialsOptions = (): PostOptionsWithCredentials => ({
      x: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          accessToken: "expired_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: nearExpiredTimestamp(),
        },
      },
    });

    const expiredPublicClientOptions = (): PostOptionsWithCredentials => ({
      x: {
        credentials: {
          clientId: "test_client_id",
          accessToken: "expired_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: nearExpiredTimestamp(),
        },
      },
    });

    it("should not refresh when the cached access token is still valid", async () => {
      publisher = new XPublisher(validCredentialsOptions());
      mockV2Client.tweet.mockResolvedValue({ data: { id: "oauth_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello!" });

      expect(result).toEqual({ id: "oauth_tweet_123", error: PostErrorType.NO_ERROR });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should refresh when the cached token is near expiry", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "refreshed_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello after refresh!" });

      expect(mockedAxios.post).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.any(URLSearchParams), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from("test_client_id:test_client_secret").toString("base64")}`,
        },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("new_access_token");
      expect(result).toEqual({
        id: "refreshed_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_access_token",
            refreshToken: "new_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should never refresh when access-token-only credentials are provided", async () => {
      publisher = new XPublisher({
        x: { credentials: { clientId: "test_client_id", accessToken: "static_access_token" } },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "static_tweet_123" } });

      const result = await publisher.postContent({ text: "Access-token-only post" });

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(MockedTwitterApi).toHaveBeenCalledWith("static_access_token");
      expect(result).toEqual({ id: "static_tweet_123", error: PostErrorType.NO_ERROR });
      expect(result.extraData).toBeUndefined();
    });

    it("should refresh on first use when only a refresh token is provided", async () => {
      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            refreshToken: "test_refresh_token",
          },
        },
      });
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "fresh_access_token", refresh_token: "fresh_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "fresh_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello from refresh-only credentials!" });

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(MockedTwitterApi).toHaveBeenLastCalledWith("fresh_access_token");
      expect(result).toEqual({
        id: "fresh_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "fresh_access_token",
            refreshToken: "fresh_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should refresh a public client (no client secret) without Basic auth", async () => {
      publisher = new XPublisher(expiredPublicClientOptions());
      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: "new_public_access_token",
          refresh_token: "new_public_refresh_token",
          expires_in: 7200,
        },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "public_refreshed_tweet_123" } });

      const result = await publisher.postContent({ text: "Hello from public OAuth!" });

      expect(mockedAxios.post).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.any(URLSearchParams), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(MockedTwitterApi).toHaveBeenCalledWith("new_public_access_token");
      expect(result).toEqual({
        id: "public_refreshed_tweet_123",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_public_access_token",
            refreshToken: "new_public_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });

    it("should propagate token refresh failures as CREDENTIALS_ERROR", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockRejectedValue({
        response: { data: { error: "invalid_grant" } },
        message: "Request failed",
      });

      await expect(publisher.postContent({ text: "This should fail" })).rejects.toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "Failed to refresh X access token", { error: "invalid_grant" }),
      );
    });

    it("should reuse a refreshed token for subsequent posts within the same publisher", async () => {
      publisher = new XPublisher(expiredCredentialsOptions());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 7200 },
      });
      mockV2Client.tweet.mockResolvedValue({ data: { id: "first_tweet" } });

      await publisher.postContent({ text: "First post with refresh" });

      jest.clearAllMocks();
      MockedTwitterApi.mockImplementation(() => mockTwitterClient);
      mockV2Client.tweet.mockResolvedValue({ data: { id: "second_tweet" } });

      const result = await publisher.postContent({ text: "Second post" });

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "second_tweet",
        error: PostErrorType.NO_ERROR,
        extraData: {
          refreshedCredentials: {
            accessToken: "new_access_token",
            refreshToken: "new_refresh_token",
            expiresAt: expect.any(Number),
          },
        },
      });
    });
  });

  describe("validate", () => {
    it("should warn when too many images are provided", () => {
      const content: Content = {
        text: "Too many images",
        media: [
          { type: "image", path: "/path/1.jpg" },
          { type: "image", path: "/path/2.jpg" },
          { type: "image", path: "/path/3.jpg" },
          { type: "image", path: "/path/4.jpg" },
          { type: "image", path: "/path/5.jpg" },
        ],
      };

      const result = XPublisher.validate(content);

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("too_many_images");
    });

    it("should error when mixing images and videos", () => {
      const content: Content = {
        text: "Mixed media",
        media: [
          { type: "image", path: "/path/1.jpg" },
          { type: "video", path: "/path/1.mp4" },
        ],
      };

      const result = XPublisher.validate(content);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe("mixed_media_not_supported");
    });

    it("should warn (not error) when text is longer than 280 but within long-post max", () => {
      const text = "a".repeat(281);
      const result = XPublisher.validate({ text, media: [{ type: "image", path: "/path/1.jpg" }] });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.code === "long_post")).toBe(true);
    });

    it("should error when text exceeds long-post max", () => {
      const text = "a".repeat(25_001);
      const result = XPublisher.validate({ text });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "text_too_long")).toBe(true);
    });
  });

  describe("post (entry method)", () => {
    beforeEach(() => {
      publisher = new XPublisher(validCredentialsOptions());
    });

    it("should post content successfully and return PostResult", async () => {
      mockV2Client.tweet.mockResolvedValue({ data: { id: "tweet_id_123" } });

      const result = await publisher.post({ text: "Hello, X!" });

      expect(result).toEqual({ id: "tweet_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should return validation errors as PostResult", async () => {
      const result = await publisher.post({});

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "X content validation failed",
        details: expect.anything(),
      });
    });

    it("should wrap API errors in a PostResult", async () => {
      mockV2Client.tweet.mockRejectedValue(new Error("API Error"));

      const result = await publisher.post({ text: "This will fail" });

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Failed to post content: Error: API Error",
        details: undefined,
      });
    });

    it("should wrap token refresh errors in a PostResult", async () => {
      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            accessToken: "expired_access_token",
            refreshToken: "test_refresh_token",
            expiresAt: nearExpiredTimestamp(),
          },
        },
      });
      mockedAxios.post.mockRejectedValue({
        response: { data: { error: "invalid_grant" } },
        message: "Request failed",
      });

      const result = await publisher.post({ text: "This should fail due to refresh error" });

      expect(result).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "Failed to refresh X access token",
        details: { error: "invalid_grant" },
      });
    });
  });
});
