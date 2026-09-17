import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { downloadToTempFile, S3MediaUploader } from "@simple-post/sdk";

import { mediaLogger } from "@/lib/logger";
import { McpToolError } from "@/lib/mcp/tool-errors";
import { uploadMedia } from "@/lib/mcp/tools/media";

jest.mock("@simple-post/sdk", () => ({
  downloadToTempFile: jest.fn(),
  generateFileKey: () => "file-key",
  S3MediaUploader: jest.fn(),
}));
jest.mock("@/lib/logger", () => ({
  mediaLogger: { child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) },
  serializeError: (e: Error) => ({ name: e.name, message: e.message }),
}));
const log = jest.mocked(mediaLogger.child).mock.results[0].value;
let directory: string;
let filename: string;
beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "simplepost-upload-test-"));
  filename = path.join(directory, "source");
  await writeFile(filename, Buffer.from("RIFF0000WAVEtest"));
  jest.mocked(downloadToTempFile).mockResolvedValue(filename);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it("rejects WAV as a client error, explains allowed formats, and removes the downloaded file", async () => {
  const input = {
    file: {
      file_id: "file",
      download_url: "https://files.example/audio",
      mime_type: "audio/wav",
      file_name: "audio.wav",
    },
  };
  const error = await uploadMedia("user", input).catch((error_) => error_);
  expect(error).toBeInstanceOf(McpToolError);
  expect(error).toMatchObject({
    code: "MEDIA_UNSUPPORTED_TYPE",
    stage: "media_validation",
    recovery: "replace_media",
    maxAutomaticRetries: 0,
  });
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.objectContaining({ message: expect.stringContaining("audio/wav") }) }),
    "MCP media upload rejected",
  );
  expect(log.error).not.toHaveBeenCalled();
  expect(S3MediaUploader).not.toHaveBeenCalled();
  await expect(access(filename)).rejects.toThrow();
});

it("imports an external URL and uploads the exact validated bytes", async () => {
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
  await writeFile(filename, jpeg);
  const uploadedChunks: Buffer[] = [];
  const uploadStream = jest.fn(async (stream: NodeJS.ReadableStream) => {
    for await (const chunk of stream) uploadedChunks.push(Buffer.from(chunk));
    return "https://storage.example/uploads/user/photo.jpg";
  });
  jest.mocked(S3MediaUploader).mockImplementation(() => ({ uploadStream }) as never);

  const result = await uploadMedia("user", {
    url: "https://files.example/photo",
    filename: "photo.jpg",
  });

  expect(downloadToTempFile).toHaveBeenCalledWith("https://files.example/photo");
  expect(Buffer.concat(uploadedChunks)).toEqual(jpeg);
  expect(result).toMatchObject({
    type: "image",
    url: "https://storage.example/uploads/user/photo.jpg",
    filename: "photo.jpg",
    size: jpeg.length,
    mimeType: "image/jpeg",
  });
  await expect(access(filename)).rejects.toThrow();
});

it("tells the model how to recover when an attached file can no longer be downloaded", async () => {
  jest.mocked(downloadToTempFile).mockRejectedValueOnce(new Error("temporary URL expired"));

  const error = await uploadMedia("user", {
    file: {
      file_id: "file",
      download_url: "https://files.example/expired",
      mime_type: "image/jpeg",
      file_name: "photo.jpg",
    },
  }).catch((error_) => error_);

  expect(error).toMatchObject({
    code: "MEDIA_FILE_REFERENCE_UNAVAILABLE",
    stage: "source_download",
    recovery: "retry_with_url_or_reattach",
    maxAutomaticRetries: 1,
    message: expect.stringContaining("retry upload_media once with url and omit file"),
  });
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      err: expect.objectContaining({ message: expect.stringContaining("reattach the file") }),
    }),
    "MCP media upload rejected",
  );
});

it("does not retry a media URL that requires authentication", async () => {
  jest.mocked(downloadToTempFile).mockRejectedValueOnce({ response: { status: 403 } });

  const error = await uploadMedia("user", { url: "https://files.example/private" }).catch((error_) => error_);

  expect(error).toMatchObject({
    code: "MEDIA_SOURCE_AUTH_REQUIRED",
    stage: "source_download",
    recovery: "replace_media",
    maxAutomaticRetries: 0,
  });
});

it("allows one retry after a transient media source failure", async () => {
  jest.mocked(downloadToTempFile).mockRejectedValueOnce({ code: "ETIMEDOUT" });

  const error = await uploadMedia("user", { url: "https://files.example/slow" }).catch((error_) => error_);

  expect(error).toMatchObject({
    code: "MEDIA_SOURCE_UNAVAILABLE",
    stage: "source_download",
    recovery: "retry_same",
    maxAutomaticRetries: 1,
    statusCode: 503,
  });
});

it("identifies an HTML response as a page rather than media", async () => {
  await writeFile(filename, Buffer.from("<!doctype html><html><body>Sign in</body></html>"));

  const error = await uploadMedia("user", { url: "https://files.example/share-page" }).catch((error_) => error_);

  expect(error).toMatchObject({
    code: "MEDIA_SOURCE_NOT_MEDIA",
    stage: "media_validation",
    recovery: "replace_media",
    maxAutomaticRetries: 0,
  });
  await expect(access(filename)).rejects.toThrow();
});

it("allows one retry after storage rejects validated media", async () => {
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
  await writeFile(filename, jpeg);
  const uploadStream = jest.fn().mockRejectedValue(new Error("storage unavailable"));
  jest.mocked(S3MediaUploader).mockImplementation(() => ({ uploadStream }) as never);

  const error = await uploadMedia("user", {
    url: "https://files.example/photo.jpg",
    filename: "photo.jpg",
  }).catch((error_) => error_);

  expect(error).toMatchObject({
    code: "MEDIA_STORAGE_FAILED",
    stage: "storage_upload",
    recovery: "retry_same",
    maxAutomaticRetries: 1,
    statusCode: 503,
  });
  await expect(access(filename)).rejects.toThrow();
});

it("absorbs a late read error on the stream it discards after a storage failure", async () => {
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
  await writeFile(filename, jpeg);
  let discarded: { emit: (event: string, error: Error) => boolean; listenerCount: (event: string) => number };
  const uploadStream = jest.fn(async (stream) => {
    discarded = stream;
    throw new Error("storage unavailable");
  });
  jest.mocked(S3MediaUploader).mockImplementation(() => ({ uploadStream }) as never);

  await expect(
    uploadMedia("user", { url: "https://files.example/photo.jpg", filename: "photo.jpg" }),
  ).rejects.toMatchObject({ code: "MEDIA_STORAGE_FAILED" });

  // The temp file is unlinked by now, so an fs.open still in flight fails on a
  // stream nobody reads. With no listener Node reports that as an uncaught
  // exception and kills the worker mid-run.
  expect(discarded!.listenerCount("error")).toBeGreaterThan(0);
  expect(() => discarded!.emit("error", new Error("ENOENT: no such file or directory"))).not.toThrow();
});

function mockStorage() {
  const uploadStream = jest.fn().mockResolvedValue("https://storage.example/uploads/user/key");
  jest.mocked(S3MediaUploader).mockImplementation(() => ({ uploadStream }) as never);
}

const mp4 = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftyp"),
    Buffer.from(brand),
    Buffer.from("isomiso2mp41"),
  ]);

it.each([
  ["a URL with no extension", "https://cdn.example/media/abc123", "abc123", "abc123.mp4"],
  ["a mislabelled .mov", "https://cdn.example/clip.mov", "clip.mov", "clip.mp4"],
])("identifies MP4 bytes behind %s", async (_label, url, name, expected) => {
  await writeFile(filename, mp4("isom"));
  mockStorage();

  // Validation re-detects from bytes later, so the stored type has to match them
  // or the object can never be published.
  await expect(uploadMedia("user", { url, filename: name })).resolves.toMatchObject({
    type: "video",
    mimeType: "video/mp4",
    filename: expected,
  });
});

it("keeps a genuine QuickTime container as QuickTime", async () => {
  await writeFile(filename, mp4("qt  "));
  mockStorage();

  await expect(
    uploadMedia("user", { url: "https://cdn.example/clip.mov", filename: "clip.mov" }),
  ).resolves.toMatchObject({ mimeType: "video/quicktime", filename: "clip.mov" });
});

it("refuses an image too large to inspect instead of storing a dead end", async () => {
  await writeFile(filename, Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(33 * 1024 * 1024)]));

  const error = await uploadMedia("user", { url: "https://cdn.example/big.jpg", filename: "big.jpg" }).catch(
    (error_) => error_,
  );
  expect(error).toMatchObject({ code: "MEDIA_IMAGE_TOO_LARGE", recovery: "replace_media" });
  expect(error.message).toContain("32 MiB");
  expect(S3MediaUploader).not.toHaveBeenCalled();
});
