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

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("XPublisher", () => {
  let publisher: XPublisher;
  let mockTwitterClient: any;
  let mockV1Client: any;
  let mockV2Client: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment variables
    process.env.TWITTER_API_KEY = "test_api_key";
    process.env.TWITTER_API_SECRET = "test_api_secret";
    process.env.TWITTER_ACCESS_TOKEN = "test_access_token";
    process.env.TWITTER_ACCESS_SECRET = "test_access_secret";

    // Mock fs
    mockedFs.existsSync.mockReturnValue(true);

    // Create mock Twitter clients
    mockV1Client = {
      uploadMedia: jest.fn(),
    };

    mockV2Client = {
      tweet: jest.fn(),
    };

    mockTwitterClient = {
      v1: mockV1Client,
      v2: mockV2Client,
    };

    // Mock TwitterApi constructor
    MockedTwitterApi.mockImplementation(() => mockTwitterClient);
  });

  describe("constructor - App Credentials", () => {
    beforeEach(() => {
      // Create a new publisher instance with app credentials
      publisher = new XPublisher({
        x: {
          credentials: {
            apiKey: "test_api_key",
            apiSecret: "test_api_secret",
            accessToken: "test_access_token",
            accessSecret: "test_access_secret",
          },
        },
      });
    });

    it("should initialize with valid app credentials", () => {
      expect(MockedTwitterApi).toHaveBeenCalledWith({
        appKey: "test_api_key",
        appSecret: "test_api_secret",
        accessToken: "test_access_token",
        accessSecret: "test_access_secret",
      });
    });

    it("should throw error if credentials are missing", () => {
      expect(() => new XPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials"),
      );
    });
  });

  describe("constructor - OAuth User Credentials", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

    beforeEach(() => {
      // Create a new publisher instance with OAuth user credentials
      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            accessToken: "test_oauth_access_token",
            refreshToken: "test_refresh_token",
            expiresAt: futureTimestamp,
          },
        },
      });
    });

    it("should initialize with valid OAuth user credentials", () => {
      expect(MockedTwitterApi).toHaveBeenCalledWith("test_oauth_access_token");
    });
  });

  describe("postContent - App Credentials", () => {
    const options: PostOptionsWithCredentials = {
      x: {
        credentials: {
          apiKey: "test_api_key",
          apiSecret: "test_api_secret",
          accessToken: "test_access_token",
          accessSecret: "test_access_secret",
        },
      },
    };

    beforeEach(() => {
      publisher = new XPublisher(options);
    });

    it("should post text-only content successfully", async () => {
      const content: Content = {
        text: "Hello, X!",
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "tweet_id_123" },
      });

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

      mockV1Client.uploadMedia.mockResolvedValue("media_id_123");
      mockV2Client.tweet.mockResolvedValue({
        data: { id: "tweet_id_456" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockV1Client.uploadMedia).toHaveBeenCalledWith("/path/to/image.jpg");
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Check out this image!", {
        media: { media_ids: ["media_id_123"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_456", error: PostErrorType.NO_ERROR });
    });

    it("should post content with reply successfully", async () => {
      const content: Content = {
        text: "This is a reply",
      };

      const replyOptions: PostOptionsWithCredentials = {
        x: {
          replyToId: "original_tweet_id",
          credentials: {
            apiKey: "test_api_key",
            apiSecret: "test_api_secret",
            accessToken: "test_access_token",
            accessSecret: "test_access_secret",
          },
        },
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "reply_tweet_id_789" },
      });

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

      mockV1Client.uploadMedia
        .mockResolvedValueOnce("media_id_1")
        .mockResolvedValueOnce("media_id_2")
        .mockResolvedValueOnce("media_id_3");

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "tweet_id_multi" },
      });

      const result = await publisher.postContent(content, options);

      expect(mockV1Client.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Multiple images", {
        media: { media_ids: ["media_id_1", "media_id_2", "media_id_3"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_multi", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported"),
      );
    });

    it("should handle API errors during posting", async () => {
      const content: Content = {
        text: "This will fail",
      };

      const apiError = new Error("API Error");
      mockV2Client.tweet.mockRejectedValue(apiError);

      await expect(publisher.postContent(content, options)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Failed to post content: Error: API Error", undefined),
      );
    });
  });

  describe("postContent - OAuth User Credentials", () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
    const nearExpiredTimestamp = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now (within 1 minute buffer)

    const validOAuthOptions: PostOptionsWithCredentials = {
      x: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          accessToken: "test_oauth_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: futureTimestamp,
        },
      },
    };

    const expiredOAuthOptions: PostOptionsWithCredentials = {
      x: {
        credentials: {
          clientId: "test_client_id",
          clientSecret: "test_client_secret",
          accessToken: "expired_access_token",
          refreshToken: "test_refresh_token",
          expiresAt: nearExpiredTimestamp,
        },
      },
    };

    it("should post with valid OAuth credentials without refresh", async () => {
      publisher = new XPublisher(validOAuthOptions);

      const content: Content = {
        text: "Hello from OAuth!",
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "oauth_tweet_123" },
      });

      const result = await publisher.postContent(content);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("Hello from OAuth!", {
        media: undefined,
        reply: undefined,
      });
      expect(result).toEqual({ id: "oauth_tweet_123", error: PostErrorType.NO_ERROR });
      expect(mockedAxios.post).not.toHaveBeenCalled(); // No refresh needed
    });

    it("should refresh token when expired and post successfully", async () => {
      publisher = new XPublisher(expiredOAuthOptions);

      const content: Content = {
        text: "Hello after refresh!",
      };

      // Mock the token refresh response
      const refreshResponse = {
        data: {
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValue(refreshResponse);

      // Mock successful tweet after refresh
      mockV2Client.tweet.mockResolvedValue({
        data: { id: "refreshed_tweet_123" },
      });

      const result = await publisher.postContent(content);

      // Verify token refresh was called
      expect(mockedAxios.post).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.any(URLSearchParams), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from("test_client_id:test_client_secret").toString("base64")}`,
        },
      });

      // Verify new TwitterApi instance was created with new token
      expect(MockedTwitterApi).toHaveBeenCalledWith("new_access_token");

      // Verify tweet was posted
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Hello after refresh!", {
        media: undefined,
        reply: undefined,
      });

      // Verify result includes refreshed credentials
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

    it("should handle token refresh failure", async () => {
      publisher = new XPublisher(expiredOAuthOptions);

      const content: Content = {
        text: "This should fail",
      };

      // Mock token refresh failure
      const refreshError = {
        response: {
          data: { error: "invalid_grant" },
        },
        message: "Request failed",
      };
      mockedAxios.post.mockRejectedValue(refreshError);

      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "Failed to refresh X access token", { error: "invalid_grant" }),
      );
    });

    it("should use refreshed token for subsequent requests", async () => {
      publisher = new XPublisher(expiredOAuthOptions);

      const content: Content = {
        text: "First post with refresh",
      };

      // Mock the token refresh response
      const refreshResponse = {
        data: {
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValue(refreshResponse);

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "first_tweet" },
      });

      // First post - should trigger refresh
      await publisher.postContent(content);

      // Reset mocks for second call
      jest.clearAllMocks();
      MockedTwitterApi.mockImplementation(() => mockTwitterClient);

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "second_tweet" },
      });

      // Second post - should not trigger refresh (token is still valid)
      const secondContent: Content = {
        text: "Second post without refresh",
      };

      const result = await publisher.postContent(secondContent);

      // Verify no refresh was called
      expect(mockedAxios.post).not.toHaveBeenCalled();

      // Verify result includes refreshed credentials (from previous refresh)
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

    it("should post OAuth content with reply successfully", async () => {
      publisher = new XPublisher(validOAuthOptions);

      const content: Content = {
        text: "OAuth reply",
      };

      const replyOptions: PostOptionsWithCredentials = {
        x: {
          replyToId: "original_tweet_id",
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            accessToken: "test_oauth_access_token",
            refreshToken: "test_refresh_token",
            expiresAt: futureTimestamp,
          },
        },
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "oauth_reply_tweet" },
      });

      const result = await publisher.postContent(content, replyOptions);

      expect(mockV2Client.tweet).toHaveBeenCalledWith("OAuth reply", {
        media: undefined,
        reply: { in_reply_to_tweet_id: "original_tweet_id" },
      });
      expect(result).toEqual({ id: "oauth_reply_tweet", error: PostErrorType.NO_ERROR });
    });
  });

  describe("post", () => {
    beforeEach(() => {
      publisher = new XPublisher({
        x: {
          credentials: {
            apiKey: "test_api_key",
            apiSecret: "test_api_secret",
            accessToken: "test_access_token",
            accessSecret: "test_access_secret",
          },
        },
      });
    });

    it("should post content successfully and return PostResult", async () => {
      const content: Content = {
        text: "Hello, X!",
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "tweet_id_123" },
      });

      const result = await publisher.post(content);

      expect(result).toEqual({ id: "tweet_id_123", error: PostErrorType.NO_ERROR });
    });

    it("should handle errors and return PostResult with error", async () => {
      const content: Content = {};

      const result = await publisher.post(content);

      expect(result).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported",
        details: undefined,
      });
    });

    it("should handle API errors and return PostResult with error", async () => {
      const content: Content = {
        text: "This will fail",
      };

      const apiError = new Error("API Error");
      mockV2Client.tweet.mockRejectedValue(apiError);

      const result = await publisher.post(content);

      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Failed to post content: Error: API Error",
        details: undefined,
      });
    });

    it("should handle OAuth token refresh errors in post method", async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now

      publisher = new XPublisher({
        x: {
          credentials: {
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
            accessToken: "expired_access_token",
            refreshToken: "test_refresh_token",
            expiresAt: expiredTimestamp,
          },
        },
      });

      const content: Content = {
        text: "This should fail due to refresh error",
      };

      // Mock token refresh failure
      const refreshError = {
        response: {
          data: { error: "invalid_grant" },
        },
        message: "Request failed",
      };
      mockedAxios.post.mockRejectedValue(refreshError);

      const result = await publisher.post(content);

      expect(result).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "Failed to refresh X access token",
        details: { error: "invalid_grant" },
      });
    });
  });
});
