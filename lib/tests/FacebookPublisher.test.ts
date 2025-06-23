import { FacebookPublisher } from "../src/publishers/facebook";
import { Content, Media } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import fs from "fs";

// Mock the facebook-js-sdk module
jest.mock("facebook-js-sdk", () => {
  return jest.fn().mockImplementation(() => ({
    post: jest.fn(),
  }));
});
jest.mock("fs");

const Facebook = require("facebook-js-sdk");
const MockedFacebook = Facebook as jest.MockedClass<typeof Facebook>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe("FacebookPublisher", () => {
  let publisher: FacebookPublisher;
  let mockFacebookInstance: any;
  let mockPost: jest.Mock;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.FACEBOOK_ACCESS_TOKEN = "test_access_token";
    process.env.FACEBOOK_PAGE_ID = "test_page_id";

    // Create mock methods
    mockPost = jest.fn();
    mockFacebookInstance = {
      post: mockPost,
    };

    // Mock the Facebook constructor to return our mock instance
    MockedFacebook.mockImplementation(() => mockFacebookInstance);

    // Mock fs methods
    mockFs.existsSync = jest.fn();
    mockFs.readFileSync = jest.fn();

    // Create a new publisher instance
    publisher = new FacebookPublisher();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.FACEBOOK_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
  });

  describe("constructor", () => {
    it("should initialize Facebook SDK with correct credentials", () => {
      expect(MockedFacebook).toHaveBeenCalledWith({
        accessToken: "test_access_token",
        graphVersion: "v19.0",
      });
    });

    it("should throw error when FACEBOOK_ACCESS_TOKEN is missing", () => {
      delete process.env.FACEBOOK_ACCESS_TOKEN;
      
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "FACEBOOK_ACCESS_TOKEN environment variable is required"
        )
      );
    });

    it("should throw error when FACEBOOK_PAGE_ID is missing", () => {
      delete process.env.FACEBOOK_PAGE_ID;
      
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "FACEBOOK_PAGE_ID environment variable is required"
        )
      );
    });
  });

  describe("post", () => {
    it("should post a text-only message to Facebook page", async () => {
      mockPost.mockResolvedValue({ data: { id: "post_123" } });
      
      const content: Content = { text: "Hello Facebook!" };
      const results = await publisher.post([content]);
      
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/feed", {
        message: "Hello Facebook!",
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_123",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post an image with caption to Facebook page", async () => {
      const mockImageBuffer = Buffer.from("fake image data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockImageBuffer);
      mockPost.mockResolvedValue({ data: { post_id: "post_456" } });
      
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "test-image.jpg" }],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockFs.existsSync).toHaveBeenCalledWith("test-image.jpg");
      expect(mockFs.readFileSync).toHaveBeenCalledWith("test-image.jpg");
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/photos", {
        source: mockImageBuffer,
        caption: "Check out this image!",
        published: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_456",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post a video with description to Facebook page", async () => {
      const mockVideoBuffer = Buffer.from("fake video data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockVideoBuffer);
      mockPost.mockResolvedValue({ data: { id: "video_789" } });
      
      const content: Content = {
        text: "Check out this video!",
        media: [{ 
          type: "video", 
          path: "test-video.mp4", 
          title: "My Test Video" 
        }],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockFs.existsSync).toHaveBeenCalledWith("test-video.mp4");
      expect(mockFs.readFileSync).toHaveBeenCalledWith("test-video.mp4");
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/videos", {
        source: mockVideoBuffer,
        description: "Check out this video!",
        title: "My Test Video",
        published: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "video_789",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle video without title", async () => {
      const mockVideoBuffer = Buffer.from("fake video data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockVideoBuffer);
      mockPost.mockResolvedValue({ data: { id: "video_default" } });
      
      const content: Content = {
        media: [{ type: "video", path: "test-video.mp4" }],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/videos", {
        source: mockVideoBuffer,
        description: "",
        title: "Video",
        published: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "video_default",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle multiple content items separately", async () => {
      mockPost
        .mockResolvedValueOnce({ data: { id: "post_1" } })
        .mockResolvedValueOnce({ data: { id: "post_2" } });
      
      const content: Content[] = [
        { text: "First post" },
        { text: "Second post" },
      ];
      
      const results = await publisher.post(content);
      
      expect(mockPost).toHaveBeenCalledTimes(2);
      expect(mockPost).toHaveBeenNthCalledWith(1, "/test_page_id/feed", {
        message: "First post",
      });
      expect(mockPost).toHaveBeenNthCalledWith(2, "/test_page_id/feed", {
        message: "Second post",
      });
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: "post_1",
        error: PostErrorType.NO_ERROR,
      });
      expect(results[1]).toEqual({
        id: "post_2",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should return error for empty content", async () => {
      const content: Content = {};
      const results = await publisher.post([content]);
      
      expect(mockPost).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported by Facebook",
        details: undefined,
      });
    });

    it("should return error for missing media path", async () => {
      const content: Content = {
        text: "Image post",
        media: [{ type: "image" } as any],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockPost).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Media path is required for Facebook photo posts",
        details: undefined,
      });
    });

    it("should return error for non-existent media file", async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const content: Content = {
        text: "Image post",
        media: [{ type: "image", path: "nonexistent.jpg" }],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockFs.existsSync).toHaveBeenCalledWith("nonexistent.jpg");
      expect(mockPost).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Media file not found at path: nonexistent.jpg",
        details: undefined,
      });
    });

    it("should handle Facebook API errors gracefully", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid access token",
            },
          },
        },
      };
      mockPost.mockRejectedValue(apiError);
      
      const content: Content = { text: "This will fail" };
      const results = await publisher.post([content]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Facebook API Error: Invalid access token",
        details: apiError,
      });
    });

    it("should handle generic errors gracefully", async () => {
      const genericError = new Error("Network error");
      mockPost.mockRejectedValue(genericError);
      
      const content: Content = { text: "This will fail" };
      const results = await publisher.post([content]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.OTHER,
        message: "Error posting to Facebook: Network error",
        details: genericError,
      });
    });

    it("should handle mixed success and failure", async () => {
      const apiError = new PostError(PostErrorType.API_ERROR, "API Error");
      mockPost
        .mockResolvedValueOnce({ data: { id: "post_success" } })
        .mockRejectedValueOnce(apiError);
      
      const content: Content[] = [
        { text: "Success post" },
        { text: "Failure post" },
      ];
      
      const results = await publisher.post(content);
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: "post_success",
        error: PostErrorType.NO_ERROR,
      });
      expect(results[1]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "API Error",
        details: undefined,
      });
    });

    it("should use post_id when available instead of id", async () => {
      mockPost.mockResolvedValue({ 
        data: { 
          id: "photo_123", 
          post_id: "post_456" 
        } 
      });
      
      const mockImageBuffer = Buffer.from("fake image data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockImageBuffer);
      
      const content: Content = {
        text: "Image with post_id",
        media: [{ type: "image", path: "test.jpg" }],
      };
      
      const results = await publisher.post([content]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_456", // Should prefer post_id over id
        error: PostErrorType.NO_ERROR,
      });
    });
  });

  describe("integration with Content types", () => {
    it("should handle all valid Content properties for images", async () => {
      const mockImageBuffer = Buffer.from("test image data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockImageBuffer);
      mockPost.mockResolvedValue({ data: { post_id: "integrated_post" } });
      
      const content: Content = {
        text: "Complete content test with image",
        media: [
          {
            type: "image",
            path: "test-image.jpg",
          },
        ],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockFs.existsSync).toHaveBeenCalledWith("test-image.jpg");
      expect(mockFs.readFileSync).toHaveBeenCalledWith("test-image.jpg");
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/photos", {
        source: mockImageBuffer,
        caption: "Complete content test with image",
        published: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "integrated_post",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should handle all valid Content properties for videos", async () => {
      const mockVideoBuffer = Buffer.from("test video data");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockVideoBuffer);
      mockPost.mockResolvedValue({ data: { id: "video_integrated" } });
      
      const content: Content = {
        text: "Complete video content test",
        media: [
          {
            type: "video",
            path: "test-video.mp4",
            title: "Integration Test Video",
            description: "A test video for integration",
            thumbnailPath: "thumbnail.jpg",
          },
        ],
      };
      
      const results = await publisher.post([content]);
      
      expect(mockFs.existsSync).toHaveBeenCalledWith("test-video.mp4");
      expect(mockFs.readFileSync).toHaveBeenCalledWith("test-video.mp4");
      expect(mockPost).toHaveBeenCalledWith("/test_page_id/videos", {
        source: mockVideoBuffer,
        description: "Complete video content test",
        title: "Integration Test Video",
        published: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "video_integrated",
        error: PostErrorType.NO_ERROR,
      });
    });
  });
});