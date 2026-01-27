import fs from "node:fs";

import axios from "axios";

import { BlueskyPublisher } from "../src/publishers/bluesky";
import { PostError, PostErrorType } from "../src/types";

import type { Content } from "../src/types/post";

jest.mock("axios");
jest.mock("fs");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("BlueskyPublisher", () => {
  let publisher: BlueskyPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock file"));

    publisher = new BlueskyPublisher({
      bluesky: {
        credentials: {
          accessToken: "test_access_token",
          did: "did:plc:123",
          pdsUrl: "https://bsky.social",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new BlueskyPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("should post text and image successfully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            blob: {
              $type: "blob",
              ref: { $link: "blob_ref" },
              mimeType: "image/jpeg",
              size: 1234,
            },
          },
        })
        .mockResolvedValueOnce({
          data: { uri: "at://did:plc:123/app.bsky.feed.post/abc" },
        });

      const content: Content = {
        text: "Hello Bluesky!",
        media: [{ type: "image", path: "./test.jpg" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("at://did:plc:123/app.bsky.feed.post/abc");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it("should reject video content", async () => {
      const content: Content = {
        text: "Video not supported",
        media: [{ type: "video", path: "./video.mp4" }],
      };

      await expect(publisher.postContent(content)).rejects.toThrow(PostError);
    });
  });
});
