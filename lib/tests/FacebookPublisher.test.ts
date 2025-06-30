import { FacebookPublisher } from "../src/publishers/facebook";
import { Content, Media } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import axios from "axios";
import fs from "fs";

// Mock axios and fs
jest.mock("axios");
jest.mock("fs");
const mockAxios = axios as jest.Mocked<typeof axios>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe("FacebookPublisher", () => {
  let publisher: FacebookPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test_page_access_token";
    process.env.FACEBOOK_PAGE_ID = "test_page_id";

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockAxios.create = jest.fn(() => mockAxiosInstance);

    // Create a new publisher instance
    publisher = new FacebookPublisher();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
  });

  describe("constructor", () => {
    it("should initialize with correct credentials", () => {
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://graph.facebook.com/v23.0',
        timeout: 30000,
      });
    });

    it("should throw error when FACEBOOK_PAGE_ACCESS_TOKEN is missing", () => {
      delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required")
      );
    });

    it("should throw error when FACEBOOK_PAGE_ID is missing", () => {
      delete process.env.FACEBOOK_PAGE_ID;
      expect(() => new FacebookPublisher()).toThrow(
        new PostError(PostErrorType.CREDENTIALS_ERROR, "FACEBOOK_PAGE_ID environment variable is required")
      );
    });
  });

  describe("validate", () => {
    beforeEach(() => {
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test_page_access_token";
      process.env.FACEBOOK_PAGE_ID = "test_page_id";
      publisher = new FacebookPublisher();
    });

    it("should throw error for multiple posts", () => {
      const content: Content[] = [{ text: "First post" }, { text: "Second post" }];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Facebook publisher only supports single posts.")
      );
    });

    it("should throw error for empty post", () => {
      const content: Content[] = [{}];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook")
      );
    });

    it("should throw error for too many images", () => {
      const content: Content[] = [{
        text: "Too many images",
        media: Array(11).fill({ type: "image", path: "test.jpg" })
      }];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Facebook supports maximum of 10 images in a single post")
      );
    });

    it("should throw error for multi-media posts with mixed types", () => {
      const content: Content[] = [{
        text: "Mixed media",
        media: [
          { type: "image", path: "test.jpg" },
          { type: "video", path: "test.mp4" }
        ]
      }];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Multi-media posts only support images")
      );
    });

    it("should throw error when media has no path", () => {
      const content: Content[] = [{
        text: "Post with media without path",
        media: [{ type: "image" }]
      }];

      expect(() => publisher.validate(content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media path is required")
      );
    });

    it("should pass validation for valid single text post", () => {
      const content: Content[] = [{ text: "Valid post" }];

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should pass validation for valid single image post", () => {
      const content: Content[] = [{
        text: "Post with image",
        media: [{ type: "image", path: "test.jpg" }]
      }];

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should pass validation for valid multiple images post", () => {
      const content: Content[] = [{
        text: "Post with multiple images",
        media: [
          { type: "image", path: "test1.jpg" },
          { type: "image", path: "test2.jpg" },
          { type: "image", path: "test3.jpg" }
        ]
      }];

      expect(() => publisher.validate(content)).not.toThrow();
    });

    it("should pass validation for valid video post", () => {
      const content: Content[] = [{
        text: "Post with video",
        media: [{ type: "video", path: "test.mp4" }]
      }];

      expect(() => publisher.validate(content)).not.toThrow();
    });
  });

  describe("uploadMedia", () => {
    beforeEach(() => {
      // Mock fs readFileSync
      mockFs.readFileSync.mockReturnValue(Buffer.from('test file content'));
      
      // Mock Blob constructor
      global.Blob = jest.fn().mockImplementation((content) => ({
        content,
        type: 'application/octet-stream'
      })) as any;
      
      // Mock FormData
      global.FormData = jest.fn().mockImplementation(() => ({
        append: jest.fn(),
      })) as any;
    });

    it("should upload image media", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "photo_id_123" } });
      
      const media: Media = { type: "image", path: "test.jpg" };
      const result = await publisher.uploadMedia(media);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/photos",
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })
      );
      expect(result).toBe("photo_id_123");
    });

    it("should upload video media with title and description", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "video_id_456" } });
      
      const media: Media = { 
        type: "video", 
        path: "test.mp4",
        title: "Test Video",
        description: "Test Description"
      };
      const result = await publisher.uploadMedia(media);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_page_id/videos",
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })
      );
      expect(result).toBe("video_id_456");
    });

    it("should throw error for unsupported media type", async () => {
      const media: Media = { type: "audio", path: "test.mp3" } as any;
      await expect(publisher.uploadMedia(media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Unsupported media type: audio")
      );
    });

    it("should handle API errors during upload", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Upload failed"
            }
          }
        }
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);
      
      const media: Media = { type: "image", path: "test.jpg" };
      await expect(publisher.uploadMedia(media)).rejects.toThrow(PostError);
    });
  });



  describe("post", () => {
    it("should post text-only content", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_123" } });
      
      const content: Content[] = [{ text: "Hello Facebook!" }];
      const results = await publisher.post(content);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Hello Facebook!",
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_id_123",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with single image", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia').mockResolvedValue("photo_id_123");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_456" } });
      
      const content: Content[] = [{
        text: "Check out this image!",
        media: [{ type: "image", path: "test.jpg" }]
      }];
      const results = await publisher.post(content);
      
      expect(publisher.uploadMedia).toHaveBeenCalledWith({ type: "image", path: "test.jpg" });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Check out this image!",
        object_attachment: "photo_id_123",
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_id_456",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with single video", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia').mockResolvedValue("video_id_789");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_789" } });
      
      const content: Content[] = [{
        text: "Check out this video!",
        media: [{ type: "video", path: "test.mp4" }]
      }];
      const results = await publisher.post(content);
      
      expect(publisher.uploadMedia).toHaveBeenCalledWith({ type: "video", path: "test.mp4" });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Check out this video!",
        object_attachment: "video_id_789",
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_id_789",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post content with multiple images", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia')
        .mockResolvedValueOnce("photo_id_1")
        .mockResolvedValueOnce("photo_id_2")
        .mockResolvedValueOnce("photo_id_3");
      
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_multi" } });
      
      const content: Content[] = [{
        text: "Multiple images!",
        media: [
          { type: "image", path: "test1.jpg" },
          { type: "image", path: "test2.jpg" },
          { type: "image", path: "test3.jpg" }
        ]
      }];
      const results = await publisher.post(content);
      
      expect(publisher.uploadMedia).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Multiple images!",
        attached_media: JSON.stringify([
          { media_fbid: "photo_id_1" },
          { media_fbid: "photo_id_2" },
          { media_fbid: "photo_id_3" }
        ]),
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_id_multi",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should return validation error for multiple posts", async () => {
      const contents: Content[] = [
        { text: "First post" },
        { text: "Second post" }
      ];
      
      const results = await publisher.post(contents);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Facebook publisher only supports single posts.",
        details: undefined,
      });
    });

    it("should return validation error for empty post", async () => {
      const content: Content[] = [{}];
      
      const results = await publisher.post(content);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Empty posts are not supported by Facebook",
        details: undefined,
      });
    });

    it("should handle API errors during posting", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Post failed"
            }
          }
        }
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);
      
      const content: Content[] = [{ text: "Will fail" }];
      const results = await publisher.post(content);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "Error posting to Facebook: Post failed",
        details: apiError.response.data,
      });
    });

    it("should return validation error if validate throws generic error", async () => {
      jest.spyOn(publisher, "validate").mockImplementation(() => {
        throw new Error("Generic validation error");
      });
      
      const content: Content[] = [{ text: "Will fail validation" }];
      const results = await publisher.post(content);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.OTHER,
        message: "An unknown error occurred while validating Facebook post.",
      });
    });
  });

  describe("integration with Content types", () => {
    it("should return validation error for mixed media types", async () => {
      const content: Content[] = [{
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
      }];

      // This should fail due to mixed media types
      const results = await publisher.post(content);
      
      expect(results).toEqual([
        {
          error: PostErrorType.INVALID_CONTENT,
          message: "Multi-media posts only support images",
          details: undefined,
        }
      ]);
    });

    it("should successfully post valid single image content", async () => {
      jest.spyOn(publisher, 'uploadMedia').mockResolvedValue("photo_id_1");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_123" } });
      
      const content: Content[] = [{
        text: "Single image post",
        media: [{
          type: "image",
          path: "img1.jpg",
        }],
      }];

      const results = await publisher.post(content);
      
      expect(results).toEqual([
        {
          id: "post_id_123",
          error: PostErrorType.NO_ERROR,
        }
      ]);
    });
  });
});