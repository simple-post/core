import { XPublisher } from "../src/publishers/x";
import { Content, Media, PostOptions } from "../src/types/post";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";
import logger from "../src/logger";
import { PostError } from "../src/types";
import { PostErrorType } from "../src/types";
import fs from "fs";

// Mock dependencies
jest.mock("twitter-api-v2");
jest.mock("../src/logger");
jest.mock("fs");

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
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
    publisher = new XPublisher();
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
      delete process.env.TWITTER_API_KEY;
      expect(() => new XPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET environment variables are required"
        )
      );
    });
  });

  describe("uploadMedia", () => {
    it("should upload media successfully", async () => {
      const media: Media = { type: "image", path: "/path/to/image.jpg" };
      const expectedMediaId = "media_id_123";

      mockV1Client.uploadMedia.mockResolvedValue(expectedMediaId);

      const result = await publisher.uploadMedia(media);

      expect(mockV1Client.uploadMedia).toHaveBeenCalledWith("/path/to/image.jpg");
      expect(result).toBe(expectedMediaId);
    });

    it("should throw error if media file does not exist", async () => {
      const media: Media = { type: "image", path: "/path/to/missing.jpg" };

      mockedFs.existsSync.mockReturnValue(false);

      await expect(publisher.uploadMedia(media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file not found: /path/to/missing.jpg")
      );
    });

    it("should handle API errors during upload", async () => {
      const media: Media = { type: "image", path: "/path/to/image.jpg" };

      const apiError = new Error("Upload failed");
      mockV1Client.uploadMedia.mockRejectedValue(apiError);

      await expect(publisher.uploadMedia(media)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error uploading media: Error: Upload failed", undefined)
      );
    });
  });

  describe("validate", () => {
    it("should validate content with text", () => {
      const content: Content = {
        text: "Hello, X!",
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should validate content with media", () => {
      const content: Content = {
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should throw error for empty content", () => {
      const content: Content = {};

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported")
      );
    });

    it("should warn about too many media files", () => {
      const content: Content = {
        text: "Too many media files",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "image", path: "/path/to/image3.jpg" },
          { type: "image", path: "/path/to/image4.jpg" },
          { type: "image", path: "/path/to/image5.jpg" },
        ],
      };

      // This should not throw in non-strict mode, but should warn
      expect(() => publisher.validate(content)).not.toThrow();
    });
  });

  describe("postContent", () => {
    it("should post text-only content successfully", async () => {
      const content: Content = {
        text: "Hello, X!",
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "tweet_id_123" },
      });

      const result = await publisher.postContent(content);

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

      const result = await publisher.postContent(content);

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

      const options: PostOptions = {
        x: {
          replyToId: "original_tweet_id",
        },
      };

      mockV2Client.tweet.mockResolvedValue({
        data: { id: "reply_tweet_id_789" },
      });

      const result = await publisher.postContent(content, options);

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

      const result = await publisher.postContent(content);

      expect(mockV1Client.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockV2Client.tweet).toHaveBeenCalledWith("Multiple images", {
        media: { media_ids: ["media_id_1", "media_id_2", "media_id_3"] },
        reply: undefined,
      });
      expect(result).toEqual({ id: "tweet_id_multi", error: PostErrorType.NO_ERROR });
    });

    it("should throw error for empty content", async () => {
      const content: Content = {};

      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported")
      );
    });

    it("should handle API errors during posting", async () => {
      const content: Content = {
        text: "This will fail",
      };

      const apiError = new Error("API Error");
      mockV2Client.tweet.mockRejectedValue(apiError);

      await expect(publisher.postContent(content)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error posting: Error: API Error", undefined)
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
        message: "Error posting: Error: API Error",
        details: undefined,
      });
    });
  });
});
