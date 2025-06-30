import { InstagramPublisher } from "../src/publishers/instagram";
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

describe("InstagramPublisher", () => {
  let publisher: InstagramPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for each test
    process.env.INSTAGRAM_ACCESS_TOKEN = "test_access_token";
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "test_business_account_id";

    // Set up mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockAxios.create = jest.fn(() => mockAxiosInstance);

    // Mock fs functions
    mockFs.existsSync = jest.fn();
    mockFs.readFileSync = jest.fn();

    // Create a new publisher instance
    publisher = new InstagramPublisher();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  });

  describe("constructor", () => {
    it("should initialize axios client with correct configuration", () => {
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: "https://graph.facebook.com/v23.0",
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      expect(publisher["client"]).toBe(mockAxiosInstance);
      expect(publisher["accessToken"]).toBe("test_access_token");
      expect(publisher["businessAccountId"]).toBe("test_business_account_id");
    });

    it("should throw error when access token is missing", () => {
      delete process.env.INSTAGRAM_ACCESS_TOKEN;

      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram access token is required. Set INSTAGRAM_ACCESS_TOKEN environment variable."
        )
      );
    });

    it("should throw error when business account ID is missing", () => {
      delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

      expect(() => new InstagramPublisher()).toThrow(
        new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Instagram business account ID is required. Set INSTAGRAM_BUSINESS_ACCOUNT_ID environment variable."
        )
      );
    });
  });

  describe("validate", () => {
    it("should throw error for multiple posts", () => {
      const content: Content[] = [{ text: "First post" }, { text: "Second post" }];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Instagram publisher only supports single posts.")
      );
    });

    it("should throw error when no media is provided", () => {
      const content: Content[] = [{ text: "Post without media" }];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video)."
        )
      );
    });

    it("should throw error when media array is empty", () => {
      const content: Content[] = [{ text: "Post with empty media", media: [] }];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(
          PostErrorType.INVALID_CONTENT,
          "Instagram posts require at least one media item (image or video)."
        )
      );
    });

    it("should throw error when more than 10 media items", () => {
      const media: Media[] = Array(11).fill({ type: "image", path: "image.jpg" });
      const content: Content[] = [{ text: "Too many media", media }];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Instagram posts support maximum 10 media items.")
      );
    });

    it("should throw error when media has no path", () => {
      const content: Content[] = [
        {
          text: "Post with media without path",
          media: [{ type: "image" } as any],
        },
      ];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file path is required for Instagram posts.")
      );
    });

    it("should throw error when media file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const content: Content[] = [
        {
          text: "Post with non-existent file",
          media: [{ type: "image", path: "nonexistent.jpg" }],
        },
      ];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media file not found at path: nonexistent.jpg")
      );
    });

    it("should throw error when caption exceeds 2200 characters", () => {
      mockFs.existsSync.mockReturnValue(true);
      const longText = "a".repeat(2201);

      const content: Content[] = [
        {
          text: longText,
          media: [{ type: "image", path: "image.jpg" }],
        },
      ];

      expect(() => publisher["validate"](content)).toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Instagram caption cannot exceed 2200 characters.")
      );
    });

    it("should pass validation for valid single image post", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          text: "Valid post",
          media: [{ type: "image", path: "image.jpg" }],
        },
      ];

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should pass validation for valid video post", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          text: "Valid video post",
          media: [{ type: "video", path: "video.mp4" }],
        },
      ];

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should pass validation for carousel post with multiple media", () => {
      mockFs.existsSync.mockReturnValue(true);

      const content: Content[] = [
        {
          text: "Carousel post",
          media: [
            { type: "image", path: "image1.jpg" },
            { type: "image", path: "image2.jpg" },
            { type: "video", path: "video.mp4" },
          ],
        },
      ];

      expect(() => publisher["validate"](content)).not.toThrow();
    });

    it("should pass validation with exactly 2200 characters", () => {
      mockFs.existsSync.mockReturnValue(true);
      const exactText = "a".repeat(2200);

      const content: Content[] = [
        {
          text: exactText,
          media: [{ type: "image", path: "image.jpg" }],
        },
      ];

      expect(() => publisher["validate"](content)).not.toThrow();
    });
  });

  describe("createMediaObject", () => {
    beforeEach(() => {
      mockFs.readFileSync.mockReturnValue(Buffer.from("fake file content"));
    });

    it("should throw error when media path is missing", async () => {
      const media: Media = { type: "image" } as any;

      await expect(publisher["createMediaObject"](media)).rejects.toThrow(
        new PostError(PostErrorType.INVALID_CONTENT, "Media path is required")
      );
    });

    it("should create media object for image file", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "media_object_123" } });
      const media: Media = { type: "image", path: "/path/to/image.jpg" };

      const result = await publisher["createMediaObject"](media);

      expect(mockFs.readFileSync).toHaveBeenCalledWith("/path/to/image.jpg");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_business_account_id/media", expect.any(FormData));
      expect(result).toBe("media_object_123");
    });

    it("should create media object for video file", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "media_object_456" } });
      const media: Media = { type: "video", path: "/path/to/video.mp4" };

      const result = await publisher["createMediaObject"](media);

      expect(mockFs.readFileSync).toHaveBeenCalledWith("/path/to/video.mp4");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/test_business_account_id/media", expect.any(FormData));
      expect(result).toBe("media_object_456");
    });

    it("should handle API errors during media object creation", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid media format",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);
      const media: Media = { type: "image", path: "/path/to/image.jpg" };

      await expect(publisher["createMediaObject"](media)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error creating media object: Invalid media format",
          apiError.response.data
        )
      );
    });

    it("should handle generic errors during media object creation", async () => {
      const genericError = new Error("Network error");
      mockAxiosInstance.post.mockRejectedValue(genericError);
      const media: Media = { type: "image", path: "/path/to/image.jpg" };

      await expect(publisher["createMediaObject"](media)).rejects.toThrow(
        new PostError(PostErrorType.API_ERROR, "Error creating media object: Network error", genericError)
      );
    });
  });

  describe("createMediaContainer", () => {
    beforeEach(() => {
      // Mock createMediaObject method
      jest.spyOn(publisher as any, "createMediaObject").mockImplementation(async (media: any) => {
        return `media_object_${media.type}_${media.path?.split("/").pop()}`;
      });
    });

    it("should create container for single image post", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "container_123" } });
      const content: Content = {
        text: "Single image post",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      const result = await publisher["createMediaContainer"](content);

      expect(publisher["createMediaObject"]).toHaveBeenCalledWith(content.media![0]);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        {
          access_token: "test_access_token",
          media_type: "IMAGE",
          media_id: "media_object_image_image.jpg",
          caption: "Single image post",
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      expect(result).toBe("container_123");
    });

    it("should create container for single video post", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "container_456" } });
      const content: Content = {
        text: "Single video post",
        media: [{ type: "video", path: "/path/to/video.mp4" }],
      };

      const result = await publisher["createMediaContainer"](content);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        {
          access_token: "test_access_token",
          media_type: "VIDEO",
          media_id: "media_object_video_video.mp4",
          caption: "Single video post",
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      expect(result).toBe("container_456");
    });

    it("should create container for carousel post", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "container_789" } });
      const content: Content = {
        text: "Carousel post",
        media: [
          { type: "image", path: "/path/to/image1.jpg" },
          { type: "image", path: "/path/to/image2.jpg" },
          { type: "video", path: "/path/to/video.mp4" },
        ],
      };

      const result = await publisher["createMediaContainer"](content);

      expect(publisher["createMediaObject"]).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        {
          access_token: "test_access_token",
          media_type: "CAROUSEL",
          children: "media_object_image_image1.jpg,media_object_image_image2.jpg,media_object_video_video.mp4",
          caption: "Carousel post",
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      expect(result).toBe("container_789");
    });

    it("should create container without caption", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "container_nocaption" } });
      const content: Content = {
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      const result = await publisher["createMediaContainer"](content);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media",
        {
          access_token: "test_access_token",
          media_type: "IMAGE",
          media_id: "media_object_image_image.jpg",
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      expect(result).toBe("container_nocaption");
    });

    it("should handle API errors during container creation", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Invalid container configuration",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);
      const content: Content = {
        text: "Test post",
        media: [{ type: "image", path: "/path/to/image.jpg" }],
      };

      await expect(publisher["createMediaContainer"](content)).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error creating Instagram media container: Invalid container configuration",
          apiError.response.data
        )
      );
    });
  });

  describe("publishMediaContainer", () => {
    it("should publish media container successfully", async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: "published_post_123" } });

      const result = await publisher["publishMediaContainer"]("container_123");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/test_business_account_id/media_publish",
        {
          access_token: "test_access_token",
          creation_id: "container_123",
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      expect(result).toBe("published_post_123");
    });

    it("should handle API errors during publishing", async () => {
      const apiError = {
        response: {
          data: {
            error: {
              message: "Publishing failed",
            },
          },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(apiError);

      await expect(publisher["publishMediaContainer"]("container_123")).rejects.toThrow(
        new PostError(
          PostErrorType.API_ERROR,
          "Error publishing Instagram post: Publishing failed",
          apiError.response.data
        )
      );
    });
  });

  describe("post (main entry point)", () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      jest.spyOn(publisher as any, "createMediaContainer").mockResolvedValue("container_123");
      jest.spyOn(publisher as any, "publishMediaContainer").mockResolvedValue("published_post_123");
    });

    it("should successfully post single image", async () => {
      const content: Content[] = [
        {
          text: "Test post",
          media: [{ type: "image", path: "/path/to/image.jpg" }],
        },
      ];

      const results = await publisher.post(content);

      expect(publisher["createMediaContainer"]).toHaveBeenCalledWith(content[0]);
      expect(publisher["publishMediaContainer"]).toHaveBeenCalledWith("container_123");
      expect(results).toEqual([
        {
          id: "published_post_123",
          error: PostErrorType.NO_ERROR,
        },
      ]);
    });

    it("should successfully post carousel", async () => {
      const content: Content[] = [
        {
          text: "Carousel post",
          media: [
            { type: "image", path: "/path/to/image1.jpg" },
            { type: "video", path: "/path/to/video.mp4" },
          ],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toEqual([
        {
          id: "published_post_123",
          error: PostErrorType.NO_ERROR,
        },
      ]);
    });

    it("should return validation error for invalid content", async () => {
      const content: Content[] = [{ text: "No media" }];

      const results = await publisher.post(content);

      expect(results).toEqual([
        {
          error: PostErrorType.INVALID_CONTENT,
          message: "Instagram posts require at least one media item (image or video).",
          details: undefined,
        },
      ]);
    });

    it("should return error when createMediaContainer fails with PostError", async () => {
      const error = new PostError(PostErrorType.API_ERROR, "Container creation failed", { code: 1 });
      jest.spyOn(publisher as any, "createMediaContainer").mockRejectedValue(error);

      const content: Content[] = [
        {
          text: "Test post",
          media: [{ type: "image", path: "/path/to/image.jpg" }],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toEqual([
        {
          error: PostErrorType.API_ERROR,
          message: "Container creation failed",
          details: { code: 1 },
        },
      ]);
    });

    it("should return error when publishMediaContainer fails with PostError", async () => {
      const error = new PostError(PostErrorType.API_ERROR, "Publishing failed", { code: 2 });
      jest.spyOn(publisher as any, "publishMediaContainer").mockRejectedValue(error);

      const content: Content[] = [
        {
          text: "Test post",
          media: [{ type: "image", path: "/path/to/image.jpg" }],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toEqual([
        {
          error: PostErrorType.API_ERROR,
          message: "Publishing failed",
          details: { code: 2 },
        },
      ]);
    });

    it("should return generic error for unexpected errors", async () => {
      const error = new Error("Unexpected error");
      jest.spyOn(publisher as any, "createMediaContainer").mockRejectedValue(error);

      const content: Content[] = [
        {
          text: "Test post",
          media: [{ type: "image", path: "/path/to/image.jpg" }],
        },
      ];

      const results = await publisher.post(content);

      expect(results).toEqual([
        {
          error: PostErrorType.OTHER,
          message: "Error posting to Instagram: Unexpected error",
          details: error,
        },
      ]);
    });
  });
});
