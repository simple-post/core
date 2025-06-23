import { FacebookPublisher } from "../src/publishers/facebook";
import { Content, Media } from "../src/types/post";
import { PostError } from "../src/types/publisher";
import { PostErrorType } from "../src/types";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

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
        baseURL: 'https://graph.facebook.com/v18.0',
        timeout: 30000,
      });
    });

    it("should throw error when FACEBOOK_PAGE_ACCESS_TOKEN is missing", () => {
      delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      expect(() => new FacebookPublisher()).toThrow("FACEBOOK_PAGE_ACCESS_TOKEN environment variable is required");
    });

    it("should throw error when FACEBOOK_PAGE_ID is missing", () => {
      delete process.env.FACEBOOK_PAGE_ID;
      expect(() => new FacebookPublisher()).toThrow("FACEBOOK_PAGE_ID environment variable is required");
    });
  });

  describe("uploadMedia", () => {
    const mockFs = {
      readFileSync: jest.fn(),
    };

    beforeEach(() => {
      // Mock the dynamic import of fs
      jest.doMock('fs', () => mockFs);
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

    it("should throw error if media path is missing", async () => {
      const media: Media = { type: "image" } as any;
      await expect(publisher.uploadMedia(media)).rejects.toThrow("Media path is required");
    });

    it("should throw error for unsupported media type", async () => {
      const media: Media = { type: "audio", path: "test.mp3" } as any;
      await expect(publisher.uploadMedia(media)).rejects.toThrow("Unsupported media type: audio");
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

  describe("postToPage", () => {
    it("should post text-only content", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_123" } });
      
      const content: Content = { text: "Hello Facebook!" };
      const result = await publisher.postToPage(content);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Hello Facebook!",
      });
      expect(result).toBe("post_id_123");
    });

    it("should post content with single image", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia').mockResolvedValue("photo_id_123");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_456" } });
      
      const content: Content = {
        text: "Check out this image!",
        media: [{ type: "image", path: "test.jpg" }]
      };
      const result = await publisher.postToPage(content);
      
      expect(publisher.uploadMedia).toHaveBeenCalledWith({ type: "image", path: "test.jpg" });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Check out this image!",
        object_attachment: "photo_id_123",
      });
      expect(result).toBe("post_id_456");
    });

    it("should post content with single video", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia').mockResolvedValue("video_id_789");
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_789" } });
      
      const content: Content = {
        text: "Check out this video!",
        media: [{ type: "video", path: "test.mp4" }]
      };
      const result = await publisher.postToPage(content);
      
      expect(publisher.uploadMedia).toHaveBeenCalledWith({ type: "video", path: "test.mp4" });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_page_id/feed", {
        access_token: "test_page_access_token",
        message: "Check out this video!",
        object_attachment: "video_id_789",
      });
      expect(result).toBe("post_id_789");
    });

    it("should post content with multiple images", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia')
        .mockResolvedValueOnce("photo_id_1")
        .mockResolvedValueOnce("photo_id_2")
        .mockResolvedValueOnce("photo_id_3");
      
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "post_id_multi" } });
      
      const content: Content = {
        text: "Multiple images!",
        media: [
          { type: "image", path: "test1.jpg" },
          { type: "image", path: "test2.jpg" },
          { type: "image", path: "test3.jpg" }
        ]
      };
      const result = await publisher.postToPage(content);
      
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
      expect(result).toBe("post_id_multi");
    });

    it("should throw error for empty post", async () => {
      const content: Content = {};
      await expect(publisher.postToPage(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Facebook")
      );
    });

    it("should throw error for multi-media posts with mixed types", async () => {
      const content: Content = {
        text: "Mixed media",
        media: [
          { type: "image", path: "test.jpg" },
          { type: "video", path: "test.mp4" }
        ]
      };
      
      await expect(publisher.postToPage(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Multi-media posts only support images")
      );
    });

    it("should throw error for too many images", async () => {
      const content: Content = {
        text: "Too many images",
        media: Array(11).fill({ type: "image", path: "test.jpg" })
      };
      
      await expect(publisher.postToPage(content)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Facebook supports maximum of 10 images in a single post")
      );
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
      
      const content: Content = { text: "Will fail" };
      await expect(publisher.postToPage(content)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error posting to Facebook: Post failed")
      );
    });
  });

  describe("post (main entry)", () => {
    it("should post a single content item", async () => {
      jest.spyOn(publisher, "postToPage").mockResolvedValue("post_id_123");
      
      const content: Content = { text: "Single post!" };
      const results = await publisher.post([content]);
      
      expect(publisher.postToPage).toHaveBeenCalledWith(content);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "post_id_123",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should post multiple content items separately", async () => {
      const spy = jest
        .spyOn(publisher, "postToPage")
        .mockResolvedValueOnce("post_id_1")
        .mockResolvedValueOnce("post_id_2")
        .mockResolvedValueOnce("post_id_3");
      
      const contents: Content[] = [
        { text: "First post" },
        { text: "Second post" },
        { text: "Third post" }
      ];
      
      const results = await publisher.post(contents);
      
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenNthCalledWith(1, contents[0]);
      expect(spy).toHaveBeenNthCalledWith(2, contents[1]);
      expect(spy).toHaveBeenNthCalledWith(3, contents[2]);
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        id: "post_id_1",
        error: PostErrorType.NO_ERROR,
      });
      expect(results[1]).toEqual({
        id: "post_id_2",
        error: PostErrorType.NO_ERROR,
      });
      expect(results[2]).toEqual({
        id: "post_id_3",
        error: PostErrorType.NO_ERROR,
      });
    });

    it("should return error result if postToPage fails with PostError", async () => {
      const error = new PostError(PostErrorType.API_ERROR, "API Error", { code: 1 });
      jest.spyOn(publisher, "postToPage").mockRejectedValue(error);
      
      const content: Content = { text: "Will fail" };
      const results = await publisher.post([content]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.API_ERROR,
        message: "API Error",
        details: { code: 1 },
      });
    });

    it("should return error result if postToPage fails with other error", async () => {
      const error = new Error("Unknown error");
      jest.spyOn(publisher, "postToPage").mockRejectedValue(error);
      
      const content: Content = { text: "Will fail" };
      const results = await publisher.post([content]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        error: PostErrorType.OTHER,
        message: "Error posting: Unknown error",
        details: error,
      });
    });

    it("should handle mixed success and failure", async () => {
      const error = new PostError(PostErrorType.INVALID_CONTENT, "Invalid content");
      const spy = jest
        .spyOn(publisher, "postToPage")
        .mockResolvedValueOnce("post_id_1")
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("post_id_3");

      const contents: Content[] = [
        { text: "First post" },
        { text: "Second post" },
        { text: "Third post" }
      ];
      
      const results = await publisher.post(contents);

      expect(spy).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        id: "post_id_1",
        error: PostErrorType.NO_ERROR,
      });
      expect(results[1]).toEqual({
        error: PostErrorType.INVALID_CONTENT,
        message: "Invalid content",
        details: undefined,
      });
      expect(results[2]).toEqual({
        id: "post_id_3",
        error: PostErrorType.NO_ERROR,
      });
    });
  });

  describe("integration with Content types", () => {
    it("should handle all valid Content properties", async () => {
      // Mock uploadMedia
      jest.spyOn(publisher, 'uploadMedia')
        .mockResolvedValueOnce("photo_id_1")
        .mockResolvedValueOnce("video_id_1");
      
      mockAxiosInstance.post.mockResolvedValue({ 
        data: { id: "post_id_complete" } 
      });

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

      // This should fail due to mixed media types
      await expect(publisher.post([content])).resolves.toEqual([
        {
          error: PostErrorType.INVALID_CONTENT,
          message: "Multi-media posts only support images",
          details: undefined,
        }
      ]);
    });
  });
});