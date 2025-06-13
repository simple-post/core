import { XPublisher } from "../publishers/x";
import { Content } from "../types/post";
import { TwitterApi, TwitterApiv2 } from "twitter-api-v2";

// Mock the entire twitter-api-v2 module
jest.mock("twitter-api-v2");

const MockedTwitterApi = TwitterApi as jest.MockedClass<typeof TwitterApi>;

describe("XPublisher", () => {
  let publisher: XPublisher;
  let mockTwitterApi: jest.Mocked<TwitterApi>;
  let mockV2: jest.Mocked<TwitterApiv2>;
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
    mockTweet = jest.fn();
    mockV2 = {
      tweet: mockTweet,
    } as any;

    // Create mock TwitterApi instance
    mockTwitterApi = {
      v2: mockV2,
      v1: {} as any,
    } as any;

    // Mock the TwitterApi constructor to return our mock instance
    MockedTwitterApi.mockImplementation(() => mockTwitterApi);

    // Create a new publisher instance
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
    });

    it("should set up v1 client reference", () => {
      expect(publisher["clientV1"]).toBeDefined();
    });
  });

  describe("post method", () => {
    it("should post text content successfully", async () => {
      // Arrange
      const content: Content = {
        text: "Hello, world! This is a test tweet.",
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: "Hello, world! This is a test tweet.",
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      expect(mockTweet).toHaveBeenCalledWith({
        text: "Hello, world! This is a test tweet.",
      });
      expect(mockTweet).toHaveBeenCalledTimes(1);
    });

    it("should post content with empty text", async () => {
      // Arrange
      const content: Content = {
        text: "",
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: "",
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      expect(mockTweet).toHaveBeenCalledWith({
        text: "",
      });
    });

    it("should post content with undefined text", async () => {
      // Arrange
      const content: Content = {
        text: undefined,
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: undefined,
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      expect(mockTweet).toHaveBeenCalledWith({
        text: undefined,
      });
    });

    it("should handle Twitter API errors gracefully", async () => {
      // Arrange
      const content: Content = {
        text: "This tweet will fail",
      };

      const apiError = new Error("Twitter API Error: Rate limit exceeded");
      mockTweet.mockRejectedValue(apiError);

      // Act & Assert
      await expect(publisher.post(content)).rejects.toThrow("Twitter API Error: Rate limit exceeded");
      expect(mockTweet).toHaveBeenCalledWith({
        text: "This tweet will fail",
      });
    });

    it("should post content with media (note: media handling not yet implemented)", async () => {
      // Arrange
      const content: Content = {
        text: "Tweet with media",
        media: [
          {
            type: "image",
            url: "https://example.com/image.jpg",
          },
        ],
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: "Tweet with media",
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      // Currently only text is handled, media is ignored
      expect(mockTweet).toHaveBeenCalledWith({
        text: "Tweet with media",
      });
    });

    it("should handle long text content", async () => {
      // Arrange
      const longText = "A".repeat(300); // Longer than Twitter's 280 character limit
      const content: Content = {
        text: longText,
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: longText,
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      expect(mockTweet).toHaveBeenCalledWith({
        text: longText,
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

    it("should handle network errors", async () => {
      // Arrange
      const content: Content = {
        text: "Network error test",
      };

      const networkError = new Error("Network Error: Unable to connect");
      mockTweet.mockRejectedValue(networkError);

      // Act & Assert
      await expect(publisher.post(content)).rejects.toThrow("Network Error: Unable to connect");
    });

    it("should handle API response errors", async () => {
      // Arrange
      const content: Content = {
        text: "API response error test",
      };

      const apiError = {
        code: 403,
        message: "Forbidden: The request is understood, but it has been refused",
        data: {
          errors: [
            {
              code: 187,
              message: "Status is a duplicate",
            },
          ],
        },
      };

      mockTweet.mockRejectedValue(apiError);

      // Act & Assert
      await expect(publisher.post(content)).rejects.toEqual(apiError);
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
            url: "https://example.com/image1.jpg",
          },
          {
            type: "video",
            url: "https://example.com/video1.mp4",
            title: "Test Video",
            description: "A test video",
            thumbnailUrl: "https://example.com/thumb1.jpg",
          },
        ],
      };

      const mockResponse = {
        data: {
          id: "1234567890",
          text: "Complete content test",
        },
      };

      mockTweet.mockResolvedValue(mockResponse);

      // Act
      await publisher.post(content);

      // Assert
      expect(mockTweet).toHaveBeenCalledWith({
        text: "Complete content test",
      });
      // Note: Media handling is not yet implemented in the XPublisher
      // This test documents the current behavior and can be updated when media support is added
    });
  });
});
