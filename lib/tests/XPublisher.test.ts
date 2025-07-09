import { XPublisher } from "../src/publishers/x";
import { Content, Media } from "../src/types/post";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";
import logger from "../src/logger";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";

// Mock the entire twitter-api-v2 module
jest.mock("twitter-api-v2");
jest.mock("../src/logger");

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;
const mockLogger = logger as any;

describe("XPublisher", () => {
  let publisher: XPublisher;
  let mockClient: any;
  let mockClientV1: any;
  let mockUploadMedia: jest.Mock;
  let mockTweet: jest.Mock;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.TWITTER_API_KEY = "test_api_key";
    process.env.TWITTER_API_SECRET = "test_api_secret";
    process.env.TWITTER_ACCESS_TOKEN = "test_access_token";
    process.env.TWITTER_ACCESS_SECRET = "test_access_secret";

    // Create mock methods
    mockUploadMedia = jest.fn();
    mockTweet = jest.fn();
    mockClientV1 = { uploadMedia: mockUploadMedia };
    mockClient = {
      v1: mockClientV1,
      v2: { tweet: mockTweet },
    };

    // Mock the TwitterApi constructor to return our mock instance
    MockedTwitterApi.mockImplementation(() => mockClient);

    // Create a new publisher instance
    mockLogger.child = jest.fn(() => mockLogger);
    mockLogger.error = jest.fn();
    mockLogger.warn = jest.fn();
    mockLogger.info = jest.fn();
    mockLogger.debug = jest.fn();
    publisher = new XPublisher();
  });

  describe("constructor", () => {
    it("should initialize TwitterApi with correct credentials", () => {
      expect(MockedTwitterApi).toHaveBeenCalledWith({
        appKey: "test_api_key",
        appSecret: "test_api_secret",
        accessToken: "test_access_token",
        accessSecret: "test_access_secret",
      });
      expect(publisher["clientV1"]).toBe(mockClientV1);
    });
  });

  describe("uploadMedia", () => {
    it("should upload media with path", async () => {
      mockUploadMedia.mockResolvedValue("media_id_1");
      const media: Media = { type: "image", path: "img.jpg" };
      const id = await publisher.uploadMedia(media);
      expect(mockUploadMedia).toHaveBeenCalledWith("img.jpg");
      expect(id).toBe("media_id_1");
    });
    it("should throw if media path is missing", async () => {
      const media: Media = { type: "image" } as any;
      await expect(publisher.uploadMedia(media)).rejects.toThrow("Media path is required");
    });
  });

  describe("postTweet", () => {
    it("should post text-only tweet", async () => {
      mockTweet.mockResolvedValue({ data: { id: "id1" } });
      const content: Content = { text: "Hello X" };
      await publisher.postTweet(content);
      expect(mockTweet).toHaveBeenCalledWith("Hello X", { media: undefined, reply: undefined });
    });
    it("should post tweet with up to 4 images", async () => {
      mockUploadMedia
        .mockResolvedValueOnce("m1")
        .mockResolvedValueOnce("m2")
        .mockResolvedValueOnce("m3")
        .mockResolvedValueOnce("m4");
      mockTweet.mockResolvedValue({ data: { id: "id2" } });
      const content: Content = {
        text: "Images!",
        media: [
          { type: "image", path: "1.jpg" },
          { type: "image", path: "2.jpg" },
          { type: "image", path: "3.jpg" },
          { type: "image", path: "4.jpg" },
        ],
      };
      await publisher.postTweet(content);
      expect(mockUploadMedia).toHaveBeenCalledTimes(4);
      expect(mockTweet).toHaveBeenCalledWith("Images!", {
        media: { media_ids: ["m1", "m2", "m3", "m4"] },
        reply: undefined,
      });
    });
    it("should warn and only post first 4 media if more than 4 provided", async () => {
      mockUploadMedia.mockResolvedValue("mid");
      mockTweet.mockResolvedValue({ data: { id: "id3" } });
      const content: Content = {
        text: "Too many!",
        media: [
          { type: "image", path: "1.jpg" },
          { type: "image", path: "2.jpg" },
          { type: "image", path: "3.jpg" },
          { type: "image", path: "4.jpg" },
          { type: "image", path: "5.jpg" },
        ],
      };
      await publisher.postTweet(content);
      expect(mockUploadMedia).toHaveBeenCalledTimes(4);
    });
    it("should post tweet with video", async () => {
      mockUploadMedia.mockResolvedValue("vid1");
      mockTweet.mockResolvedValue({ data: { id: "id4" } });
      const content: Content = {
        text: "Video!",
        media: [{ type: "video", path: "1.mp4" }],
      };
      await publisher.postTweet(content);
      expect(mockUploadMedia).toHaveBeenCalledWith("1.mp4");
      expect(mockTweet).toHaveBeenCalledWith("Video!", {
        media: { media_ids: ["vid1"] },
        reply: undefined,
      });
    });
    it("should log error and skip media if upload fails", async () => {
      mockUploadMedia.mockRejectedValueOnce(new Error("fail"));
      mockUploadMedia.mockResolvedValueOnce("m2");
      mockTweet.mockResolvedValue({ data: { id: "id5" } });
      const content: Content = {
        text: "Partial media",
        media: [
          { type: "image", path: "bad.jpg" },
          { type: "image", path: "good.jpg" },
        ],
      };
      await expect(publisher.postTweet(content)).rejects.toThrow("fail");
    });
    it("should log error and not post if tweet is empty", async () => {
      const content: Content = {};
      await expect(publisher.postTweet(content)).rejects.toThrow("Empty posts are not supported by X");
      expect(mockTweet).not.toHaveBeenCalled();
    });
    it("should support replyTo for threads", async () => {
      mockTweet.mockResolvedValue({ data: { id: "id6" } });
      const content: Content = { text: "Reply!" };
      await publisher.postTweet(content, "parentId");
      expect(mockTweet).toHaveBeenCalledWith("Reply!", {
        media: undefined,
        reply: { in_reply_to_tweet_id: "parentId" },
      });
    });
    it("should log info with tweet id", async () => {
      mockTweet.mockResolvedValue({ data: { id: "id7" } });
      const content: Content = { text: "Info log" };
      await publisher.postTweet(content);
    });
  });

  describe("post (main entry)", () => {
    it("should post a single tweet", async () => {
      jest.spyOn(publisher, "postTweet").mockResolvedValue("tid");
      const content: Content = { text: "Single!" };
      const options = {};
      await publisher.post(content, options);
      expect(publisher.postTweet).toHaveBeenCalledWith(content, undefined);
    });

    it("should post a tweet with reply", async () => {
      jest.spyOn(publisher, "postTweet").mockResolvedValue("tid");
      const content: Content = { text: "Reply tweet!" };
      const options = { x: { replyToId: "parent_id" } };
      await publisher.post(content, options);
      expect(publisher.postTweet).toHaveBeenCalledWith(content, "parent_id");
    });

    it("should return error result if postTweet fails with PostError", async () => {
      const error = new PostError(PostErrorType.API_ERROR, "API Error", { code: 1 });
      jest.spyOn(publisher, "postTweet").mockRejectedValue(error);
      const content: Content = { text: "Will fail" };
      const options = {};
      const result = await publisher.post(content, options);
      expect(result).toEqual({
        error: PostErrorType.API_ERROR,
        message: "API Error",
        details: { code: 1 },
      });
    });

    it("should return error result if postTweet fails with other error", async () => {
      const error = new Error("Unknown error");
      jest.spyOn(publisher, "postTweet").mockRejectedValue(error);
      const content: Content = { text: "Will fail" };
      const options = {};
      const result = await publisher.post(content, options);
      expect(result).toEqual({
        error: PostErrorType.OTHER,
        message: "Error posting: Unknown error",
        details: error,
      });
    });
  });

  describe("error handling", () => {
    it("should throw error when Twitter API credentials are invalid", () => {
      // Mock TwitterApi constructor to throw an error
      MockedTwitterApi.mockImplementation(() => {
        throw new Error("Invalid consumer tokens");
      });

      // Act & Assert
      expect(() => new XPublisher()).toThrow("Invalid consumer tokens");
    });
  });

  describe("integration with Content types", () => {
    it("should handle all valid Content properties", async () => {
      // Arrange
      const content: Content = {
        text: "Complete content test",
        media: [
          {
            type: "image",
            path: "img1.jpg",
          },
          {
            type: "video",
            path: "vid1.mp4",
            title: "Test Video",
            description: "A test video",
            thumbnailPath: "thumb1.jpg",
          },
        ],
      };

      mockUploadMedia.mockResolvedValueOnce("img1id").mockResolvedValueOnce("vid1id");
      mockTweet.mockResolvedValue({ data: { id: "1234567890", text: "Complete content test" } });

      // Act
      await publisher.post(content, {});

      // Assert
      expect(mockUploadMedia).toHaveBeenCalledWith("img1.jpg");
      expect(mockUploadMedia).toHaveBeenCalledWith("vid1.mp4");
      expect(mockTweet).toHaveBeenCalledWith("Complete content test", {
        media: { media_ids: ["img1id", "vid1id"] },
        reply: undefined,
      });
    });
  });
});
