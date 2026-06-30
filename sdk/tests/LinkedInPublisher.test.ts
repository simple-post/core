import fs from "node:fs";

import axios from "axios";

import { LinkedInPublisher } from "../src/publishers/linkedin";
import { PostError, PostErrorType } from "../src/types";

import type { Content } from "../src/types/post";

jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("LinkedInPublisher", () => {
  let publisher: LinkedInPublisher;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    mockedAxios.put.mockResolvedValue({ status: 201 });

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.createReadStream.mockReturnValue({} as any);

    publisher = new LinkedInPublisher({
      linkedin: {
        credentials: {
          accessToken: "test_access_token",
          memberId: "member_123",
        },
      },
    });
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new LinkedInPublisher()).toThrow(PostError);
    });
  });

  describe("postContent", () => {
    it("should post an image successfully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            value: {
              asset: "urn:li:digitalmediaAsset:123",
              uploadMechanism: {
                "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
                  uploadUrl: "https://upload.linkedin.com/file",
                },
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: { id: "urn:li:ugcPost:456" },
          headers: {},
        });

      const content: Content = {
        text: "Hello LinkedIn!",
        media: [{ type: "image", path: "./image.jpg" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("urn:li:ugcPost:456");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockedAxios.put).toHaveBeenCalled();
    });
  });
});
