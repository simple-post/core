import fs from "node:fs";
import os from "node:os";
import { Readable } from "node:stream";

import axios from "axios";

import {
  isUrl,
  getMediaSource,
  hasValidSource,
  downloadToTempFile,
  resolveMediaPath,
  resolveThumbnailPath,
  resolveMediaUrl,
  TempFileManager,
} from "../src/utils/media";

import type { Image, Video } from "../src/types/post";

// Mock dependencies
jest.mock("axios");
jest.mock("node:fs");
jest.mock("node:os");
jest.mock("uuid", () => ({
  v7: jest.fn(() => "mock-uuid-v7"),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedOs = os as jest.Mocked<typeof os>;

describe("Media Utilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedOs.tmpdir.mockReturnValue("/tmp");
  });

  describe("isUrl", () => {
    it("should return true for http URLs", () => {
      expect(isUrl("http://example.com/image.jpg")).toBe(true);
    });

    it("should return true for https URLs", () => {
      expect(isUrl("https://example.com/image.jpg")).toBe(true);
    });

    it("should return true for URLs with query parameters", () => {
      expect(isUrl("https://example.com/image.jpg?size=large&format=png")).toBe(true);
    });

    it("should return true for URLs with ports", () => {
      expect(isUrl("https://example.com:8080/image.jpg")).toBe(true);
    });

    it("should return false for file paths", () => {
      expect(isUrl("/path/to/file.jpg")).toBe(false);
    });

    it("should return false for relative paths", () => {
      expect(isUrl("./images/file.jpg")).toBe(false);
    });

    it("should return false for Windows paths", () => {
      expect(isUrl("C:\\Users\\test\\image.jpg")).toBe(false);
    });

    it("should return false for ftp URLs", () => {
      expect(isUrl("ftp://example.com/file.jpg")).toBe(false);
    });

    it("should return false for invalid strings", () => {
      expect(isUrl("not a url")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isUrl("")).toBe(false);
    });
  });

  describe("getMediaSource", () => {
    it("should return path when only path is provided", () => {
      const media: Image = { type: "image", path: "/path/to/image.jpg" };
      expect(getMediaSource(media)).toBe("/path/to/image.jpg");
    });

    it("should return url when only url is provided", () => {
      const media: Image = { type: "image", url: "https://example.com/image.jpg" };
      expect(getMediaSource(media)).toBe("https://example.com/image.jpg");
    });

    it("should return path when both path and url are provided", () => {
      const media: Image = {
        type: "image",
        path: "/path/to/image.jpg",
        url: "https://example.com/image.jpg",
      };
      expect(getMediaSource(media)).toBe("/path/to/image.jpg");
    });

    it("should return undefined when neither path nor url is provided", () => {
      const media: Image = { type: "image" };
      expect(getMediaSource(media)).toBeUndefined();
    });
  });

  describe("hasValidSource", () => {
    it("should return true when path is provided", () => {
      const media: Image = { type: "image", path: "/path/to/image.jpg" };
      expect(hasValidSource(media)).toBe(true);
    });

    it("should return true when url is provided", () => {
      const media: Image = { type: "image", url: "https://example.com/image.jpg" };
      expect(hasValidSource(media)).toBe(true);
    });

    it("should return true when both are provided", () => {
      const media: Image = {
        type: "image",
        path: "/path/to/image.jpg",
        url: "https://example.com/image.jpg",
      };
      expect(hasValidSource(media)).toBe(true);
    });

    it("should return false when neither is provided", () => {
      const media: Image = { type: "image" };
      expect(hasValidSource(media)).toBe(false);
    });

    it("should return false for empty path", () => {
      const media: Image = { type: "image", path: "" };
      expect(hasValidSource(media)).toBe(false);
    });

    it("should return false for empty url", () => {
      const media: Image = { type: "image", url: "" };
      expect(hasValidSource(media)).toBe(false);
    });
  });

  // Helper function to create mock streams for testing
  const createMockStream = (data: string = "mock data"): Readable => {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    return readable;
  };

  describe("downloadToTempFile", () => {
    let mockWriteStream: {
      on: jest.Mock;
      write: jest.Mock;
      end: jest.Mock;
      once: jest.Mock;
      emit: jest.Mock;
    };
    let mockReadableStream: Readable;

    beforeEach(() => {
      mockWriteStream = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      };

      mockedFs.createWriteStream.mockReturnValue(mockWriteStream as any);
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.unlinkSync.mockImplementation(() => {});
    });

    it("should download file and return temp path with extension from URL", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: {},
      });

      const result = await downloadToTempFile("https://example.com/video.mp4");

      expect(mockedAxios.get).toHaveBeenCalledWith("https://example.com/video.mp4", {
        responseType: "stream",
        timeout: 120_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.mp4");
      expect(mockedFs.createWriteStream).toHaveBeenCalledWith("/tmp/simplepost_mock-uuid-v7.mp4");
    });

    it("should use preferred extension when provided", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: {},
      });

      const result = await downloadToTempFile("https://example.com/file", ".mov");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.mov");
    });

    it("should detect extension from content-type when URL has no extension", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "video/mp4" },
      });

      const result = await downloadToTempFile("https://example.com/video");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.mp4");
    });

    it("should detect jpg extension from image/jpeg content-type", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "image/jpeg" },
      });

      const result = await downloadToTempFile("https://example.com/image");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.jpg");
    });

    it("should detect png extension from image/png content-type", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "image/png" },
      });

      const result = await downloadToTempFile("https://example.com/image");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.png");
    });

    it("should detect webm extension from video/webm content-type", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "video/webm" },
      });

      const result = await downloadToTempFile("https://example.com/video");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.webm");
    });

    it("should handle content-type with charset", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "image/gif; charset=utf-8" },
      });

      const result = await downloadToTempFile("https://example.com/image");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.gif");
    });

    it("should use .tmp extension when no extension can be determined", async () => {
      mockReadableStream = createMockStream();

      mockedAxios.get.mockResolvedValue({
        data: mockReadableStream,
        headers: { "content-type": "application/octet-stream" },
      });

      const result = await downloadToTempFile("https://example.com/file");

      expect(result).toBe("/tmp/simplepost_mock-uuid-v7.tmp");
    });

    it("should clean up temp file on axios error", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedAxios.get.mockRejectedValue(new Error("Network error"));

      await expect(downloadToTempFile("https://example.com/video.mp4")).rejects.toThrow("Network error");

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it("should clean up temp file on stream pipeline error", async () => {
      // Create a stream that will error
      const errorStream = new Readable({
        read() {
          this.destroy(new Error("Stream error"));
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: errorStream,
        headers: {},
      });

      mockedFs.existsSync.mockReturnValue(true);

      await expect(downloadToTempFile("https://example.com/video.mp4")).rejects.toThrow();

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });
      mockedAxios.get.mockRejectedValue(new Error("Network error"));

      // Should not throw from cleanup, only from the original error
      await expect(downloadToTempFile("https://example.com/video.mp4")).rejects.toThrow("Network error");
    });

    describe("SSRF validation", () => {
      it("should reject localhost URLs", async () => {
        await expect(downloadToTempFile("http://localhost/image.jpg")).rejects.toThrow(
          "Access to localhost URLs is not allowed",
        );
        await expect(downloadToTempFile("http://localhost:8080/image.jpg")).rejects.toThrow(
          "Access to localhost URLs is not allowed",
        );
      });

      it("should reject 127.0.0.1", async () => {
        await expect(downloadToTempFile("http://127.0.0.1/image.jpg")).rejects.toThrow(
          "Access to localhost URLs is not allowed",
        );
      });

      it("should reject IPv6 loopback ::1", async () => {
        await expect(downloadToTempFile("http://[::1]/image.jpg")).rejects.toThrow(
          "Access to localhost URLs is not allowed",
        );
      });

      it("should reject 0.0.0.0", async () => {
        await expect(downloadToTempFile("http://0.0.0.0/image.jpg")).rejects.toThrow(
          "Access to localhost URLs is not allowed",
        );
      });

      it("should reject private Class A IPs (10.x.x.x)", async () => {
        await expect(downloadToTempFile("http://10.0.0.1/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
        await expect(downloadToTempFile("http://10.255.255.255/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
      });

      it("should reject private Class B IPs (172.16.x.x - 172.31.x.x)", async () => {
        await expect(downloadToTempFile("http://172.16.0.1/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
        await expect(downloadToTempFile("http://172.31.255.255/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
      });

      it("should reject private Class C IPs (192.168.x.x)", async () => {
        await expect(downloadToTempFile("http://192.168.0.1/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
        await expect(downloadToTempFile("http://192.168.255.255/image.jpg")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
      });

      it("should reject link-local/cloud metadata IPs (169.254.x.x)", async () => {
        await expect(downloadToTempFile("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
          "Access to private/internal IP addresses is not allowed",
        );
      });

      it("should reject metadata hostnames", async () => {
        await expect(downloadToTempFile("http://metadata.google.internal/computeMetadata/v1/")).rejects.toThrow(
          "Access to internal/metadata endpoints is not allowed",
        );
      });

      it("should reject .internal hostnames", async () => {
        await expect(downloadToTempFile("http://some-service.internal/api")).rejects.toThrow(
          "Access to internal/metadata endpoints is not allowed",
        );
      });

      it("should reject non-http/https protocols", async () => {
        await expect(downloadToTempFile("file:///etc/passwd")).rejects.toThrow(
          "Invalid URL protocol: file:. Only http and https are allowed.",
        );
        await expect(downloadToTempFile("ftp://example.com/file.jpg")).rejects.toThrow(
          "Invalid URL protocol: ftp:. Only http and https are allowed.",
        );
      });

      it("should reject invalid URLs", async () => {
        await expect(downloadToTempFile("not-a-valid-url")).rejects.toThrow("Invalid URL: not-a-valid-url");
      });

      it("should allow valid public URLs", async () => {
        const mockStream = createMockStream();

        mockedAxios.get.mockResolvedValue({
          data: mockStream,
          headers: {},
        });

        // These should not throw SSRF errors
        await expect(downloadToTempFile("https://example.com/image.jpg")).resolves.toBeDefined();
      });

      it("should allow public IP addresses", async () => {
        const mockStream = createMockStream();

        mockedAxios.get.mockResolvedValue({
          data: mockStream,
          headers: {},
        });

        // Public IP should be allowed
        await expect(downloadToTempFile("https://8.8.8.8/image.jpg")).resolves.toBeDefined();
      });
    });
  });

  describe("resolveMediaPath", () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(false);
    });

    it("should return path directly when media has path", async () => {
      const media: Image = { type: "image", path: "/local/path/image.jpg" };

      const result = await resolveMediaPath(media);

      expect(result.path).toBe("/local/path/image.jpg");
      expect(result.isTemp).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should provide no-op cleanup function when using path", async () => {
      const media: Image = { type: "image", path: "/local/path/image.jpg" };

      const result = await resolveMediaPath(media);

      // Cleanup should be a no-op
      await expect(result.cleanup()).resolves.toBeUndefined();
    });

    it("should download and return temp path when media has url", async () => {
      const mockStream = new Readable({
        read() {
          this.push("data");
          this.push(null);
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: mockStream,
        headers: { "content-type": "image/jpeg" },
      });
      mockedFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as any);

      const media: Image = { type: "image", url: "https://example.com/image.jpg" };

      const result = await resolveMediaPath(media);

      expect(result.path).toContain("simplepost_mock-uuid-v7");
      expect(result.isTemp).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it("should cleanup temp file when cleanup is called", async () => {
      const mockStream = new Readable({
        read() {
          this.push("data");
          this.push(null);
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: mockStream,
        headers: {},
      });
      mockedFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as any);
      mockedFs.existsSync.mockReturnValue(true);

      const media: Image = { type: "image", url: "https://example.com/image.jpg" };

      const result = await resolveMediaPath(media);
      await result.cleanup();

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully", async () => {
      const mockStream = new Readable({
        read() {
          this.push("data");
          this.push(null);
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: mockStream,
        headers: {},
      });
      mockedFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as any);
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const media: Image = { type: "image", url: "https://example.com/image.jpg" };

      const result = await resolveMediaPath(media);

      // Should not throw
      await expect(result.cleanup()).resolves.toBeUndefined();
    });

    it("should throw error when media has neither path nor url", async () => {
      const media: Image = { type: "image" };

      await expect(resolveMediaPath(media)).rejects.toThrow("Media must have either a path or url");
    });

    it("should prefer path over url when both are provided", async () => {
      const media: Image = {
        type: "image",
        path: "/local/path/image.jpg",
        url: "https://example.com/image.jpg",
      };

      const result = await resolveMediaPath(media);

      expect(result.path).toBe("/local/path/image.jpg");
      expect(result.isTemp).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("resolveThumbnailPath", () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(false);
    });

    it("should return thumbnailPath directly when video has thumbnailPath", async () => {
      const video: Video = {
        type: "video",
        path: "/video.mp4",
        thumbnailPath: "/local/path/thumbnail.jpg",
      };

      const result = await resolveThumbnailPath(video);

      expect(result.path).toBe("/local/path/thumbnail.jpg");
      expect(result.isTemp).toBe(false);
    });

    it("should download and return temp path when video has thumbnailUrl", async () => {
      const mockStream = new Readable({
        read() {
          this.push("data");
          this.push(null);
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: mockStream,
        headers: { "content-type": "image/jpeg" },
      });
      mockedFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as any);

      const video: Video = {
        type: "video",
        path: "/video.mp4",
        thumbnailUrl: "https://example.com/thumbnail.jpg",
      };

      const result = await resolveThumbnailPath(video);

      expect(result.path).toContain("simplepost_mock-uuid-v7");
      expect(result.isTemp).toBe(true);
    });

    it("should return undefined path when video has no thumbnail", async () => {
      const video: Video = {
        type: "video",
        path: "/video.mp4",
      };

      const result = await resolveThumbnailPath(video);

      expect(result.path).toBeUndefined();
      expect(result.isTemp).toBe(false);
    });

    it("should cleanup temp thumbnail when cleanup is called", async () => {
      const mockStream = new Readable({
        read() {
          this.push("data");
          this.push(null);
        },
      });

      mockedAxios.get.mockResolvedValue({
        data: mockStream,
        headers: {},
      });
      mockedFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as any);
      mockedFs.existsSync.mockReturnValue(true);

      const video: Video = {
        type: "video",
        path: "/video.mp4",
        thumbnailUrl: "https://example.com/thumbnail.jpg",
      };

      const result = await resolveThumbnailPath(video);
      await result.cleanup();

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it("should prefer thumbnailPath over thumbnailUrl when both are provided", async () => {
      const video: Video = {
        type: "video",
        path: "/video.mp4",
        thumbnailPath: "/local/path/thumbnail.jpg",
        thumbnailUrl: "https://example.com/thumbnail.jpg",
      };

      const result = await resolveThumbnailPath(video);

      expect(result.path).toBe("/local/path/thumbnail.jpg");
      expect(result.isTemp).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("TempFileManager", () => {
    it("should add cleanup functions", () => {
      const manager = new TempFileManager();
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);

      manager.add(cleanup1);
      manager.add(cleanup2);

      // No assertion needed - just verifying it doesn't throw
    });

    it("should call all cleanup functions on cleanup", async () => {
      const manager = new TempFileManager();
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);
      const cleanup3 = jest.fn().mockResolvedValue(undefined);

      manager.add(cleanup1);
      manager.add(cleanup2);
      manager.add(cleanup3);

      await manager.cleanup();

      expect(cleanup1).toHaveBeenCalledTimes(1);
      expect(cleanup2).toHaveBeenCalledTimes(1);
      expect(cleanup3).toHaveBeenCalledTimes(1);
    });

    it("should call all cleanup functions in parallel", async () => {
      const manager = new TempFileManager();
      const callOrder: number[] = [];

      const cleanup1 = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push(1);
      });
      const cleanup2 = jest.fn().mockImplementation(async () => {
        callOrder.push(2);
      });

      manager.add(cleanup1);
      manager.add(cleanup2);

      await manager.cleanup();

      // cleanup2 should complete before cleanup1 due to setTimeout
      expect(callOrder).toEqual([2, 1]);
    });

    it("should clear cleanup functions after cleanup", async () => {
      const manager = new TempFileManager();
      const cleanup = jest.fn().mockResolvedValue(undefined);

      manager.add(cleanup);
      await manager.cleanup();

      // Second cleanup should not call the function again
      await manager.cleanup();

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("should handle empty cleanup list", async () => {
      const manager = new TempFileManager();

      // Should not throw
      await expect(manager.cleanup()).resolves.toBeUndefined();
    });

    it("should handle cleanup function errors gracefully", async () => {
      const manager = new TempFileManager();
      const cleanup1 = jest.fn().mockRejectedValue(new Error("Cleanup error 1"));
      const cleanup2 = jest.fn().mockResolvedValue(undefined);
      const cleanup3 = jest.fn().mockRejectedValue(new Error("Cleanup error 3"));

      manager.add(cleanup1);
      manager.add(cleanup2);
      manager.add(cleanup3);

      // All cleanup functions should be attempted despite errors
      // Note: Promise.all will reject, but all functions are called
      await expect(manager.cleanup()).rejects.toThrow();

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(cleanup3).toHaveBeenCalled();
    });
  });

  describe("resolveMediaUrl", () => {
    it("should return url directly when media has url", async () => {
      const media: Image = { type: "image", url: "https://example.com/image.jpg" };
      const uploadFile = jest.fn();

      const result = await resolveMediaUrl(media, uploadFile);

      expect(result.url).toBe("https://example.com/image.jpg");
      expect(result.uploadedKey).toBeUndefined();
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("should upload file and return url when media has path", async () => {
      const media: Image = { type: "image", path: "/local/path/image.jpg" };
      const uploadFile = jest.fn().mockResolvedValue("https://s3.example.com/uploaded-image.jpg");

      const result = await resolveMediaUrl(media, uploadFile);

      expect(uploadFile).toHaveBeenCalledWith("/local/path/image.jpg", "mock-uuid-v7_image.jpg");
      expect(result.url).toBe("https://s3.example.com/uploaded-image.jpg");
      expect(result.uploadedKey).toBe("mock-uuid-v7_image.jpg");
    });

    it("should generate correct key with uuid and basename", async () => {
      const media: Image = { type: "image", path: "/some/nested/path/photo.png" };
      const uploadFile = jest.fn().mockResolvedValue("https://s3.example.com/photo.png");

      await resolveMediaUrl(media, uploadFile);

      expect(uploadFile).toHaveBeenCalledWith("/some/nested/path/photo.png", "mock-uuid-v7_photo.png");
    });

    it("should throw error when media has neither path nor url", async () => {
      const media: Image = { type: "image" };
      const uploadFile = jest.fn();

      await expect(resolveMediaUrl(media, uploadFile)).rejects.toThrow("Media must have either a path or url");
    });

    it("should prefer url over path when both are provided", async () => {
      const media: Image = {
        type: "image",
        path: "/local/path/image.jpg",
        url: "https://example.com/image.jpg",
      };
      const uploadFile = jest.fn();

      const result = await resolveMediaUrl(media, uploadFile);

      expect(result.url).toBe("https://example.com/image.jpg");
      expect(result.uploadedKey).toBeUndefined();
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("should propagate upload errors", async () => {
      const media: Image = { type: "image", path: "/local/path/image.jpg" };
      const uploadFile = jest.fn().mockRejectedValue(new Error("Upload failed"));

      await expect(resolveMediaUrl(media, uploadFile)).rejects.toThrow("Upload failed");
    });

    it("should work with video media type", async () => {
      const media: Video = { type: "video", path: "/local/path/video.mp4", title: "My Video" };
      const uploadFile = jest.fn().mockResolvedValue("https://s3.example.com/video.mp4");

      const result = await resolveMediaUrl(media, uploadFile);

      expect(uploadFile).toHaveBeenCalledWith("/local/path/video.mp4", "mock-uuid-v7_video.mp4");
      expect(result.url).toBe("https://s3.example.com/video.mp4");
    });
  });
});
