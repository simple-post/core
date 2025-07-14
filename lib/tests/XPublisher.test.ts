import fs from "node:fs";

import { TwitterApi } from "twitter-api-v2";

import { XPublisher } from "../src/publishers/x";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

// Mock dependencies
jest.mock("twitter-api-v2");
jest.mock("fs");

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockedFs = fs as jest.Mocked<typeof fs>;

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

    // Create a new publisher instance
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

  describe("constructor", () => {
    it("should initialize with valid credentials", () => {
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

  describe("postContent", () => {
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

  describe("post", () => {
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
  });
});
