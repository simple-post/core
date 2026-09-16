import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { downloadToTempFile, S3MediaUploader } from "@simple-post/sdk";

import { mediaLogger } from "@/lib/logger";
import { uploadMedia } from "@/lib/mcp/tools/media";
import { BadRequestError } from "@/lib/utils/errors";

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
  await expect(uploadMedia("user", input)).rejects.toBeInstanceOf(BadRequestError);
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

  await expect(
    uploadMedia("user", {
      file: {
        file_id: "file",
        download_url: "https://files.example/expired",
        mime_type: "image/jpeg",
        file_name: "photo.jpg",
      },
    }),
  ).rejects.toThrow("retry upload_media once with url and omit file");
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      err: expect.objectContaining({ message: expect.stringContaining("reattach the file") }),
    }),
    "MCP media upload rejected",
  );
});
