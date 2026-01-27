import axios from "axios";

import { PinterestPublisher } from "../src/publishers/pinterest";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://cdn.example.com/image.jpg"),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("PinterestPublisher", () => {
  let publisher: PinterestPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    publisher = new PinterestPublisher({
      pinterest: {
        boardId: "board_123",
        credentials: {
          accessToken: "test_access_token",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new PinterestPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("should create an image pin successfully", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { id: "pin_123" },
      });

      const content: Content = {
        text: "Pinterest pin",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      const options: PostOptionsWithCredentials = {
        pinterest: {
          boardId: "board_123",
          credentials: {
            accessToken: "test_access_token",
          },
        },
      };

      const result = await publisher.postContent(content, options);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("pin_123");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/pins",
        expect.objectContaining({
          board_id: "board_123",
          media_source: expect.objectContaining({ source_type: "image_url" }),
        }),
      );
    });

    it("should throw if boardId is missing", async () => {
      const content: Content = {
        text: "Pinterest pin",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      await expect(
        publisher.postContent(content, { pinterest: { credentials: { accessToken: "token" } } } as any),
      ).rejects.toThrow(PostError);
    });
  });
});
