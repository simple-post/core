import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { fitRemoteImagesForAccounts } from "../src/utils/image-fitting";
import { downloadToTempFile } from "../src/utils/media";
import { S3MediaUploader } from "../src/utils/s3";

import type { ImageFitContent } from "../src/utils/image-fitting";

jest.mock("../src/utils/media", () => ({ ...jest.requireActual("../src/utils/media"), downloadToTempFile: jest.fn() }));
jest.mock("../src/utils/s3", () => ({ ...jest.requireActual("../src/utils/s3"), S3MediaUploader: jest.fn() }));

const upload = jest.fn();
const remove = jest.fn();
let directory: string;
let image: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "remote-fit-"));
  image = await sharp({ create: { width: 400, height: 800, channels: 3, background: "red" } })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});
beforeEach(() => {
  jest.clearAllMocks();
  let index = 0;
  jest.mocked(downloadToTempFile).mockImplementation(async () => {
    const file = path.join(directory, `${index++}.png`);
    await writeFile(file, image);
    return file;
  });
  upload.mockImplementation(async (_stream, key) => `https://cdn.example.com/${key}`);
  remove.mockImplementation(async () => {});
  jest
    .mocked(S3MediaUploader)
    .mockImplementation(() => ({ uploadStream: upload, deleteFile: remove }) as unknown as S3MediaUploader);
});

const media = (name: string) => ({
  id: name,
  type: "image" as const,
  filename: `${name}.png`,
  url: `https://source.example.com/${name}.png`,
  size: 0,
});

it("fits shared images to shared targets and account overrides independently, retaining source objects", async () => {
  const original = media("original");
  const content: ImageFitContent = { media: [original], accountOverrides: { tt: { media: [media("override")] } } };
  const registered = jest.fn().mockImplementation(async () => {});
  await fitRemoteImagesForAccounts(
    content,
    [
      { id: "ig", platform: "instagram" },
      { id: "tt", platform: "tiktok" },
    ],
    "blur",
    "user-1",
    registered,
  );
  expect(content.media[0].url).toContain("/uploads/user-1/");
  expect(content.accountOverrides!.tt.media![0].url).toContain("/uploads/user-1/");
  expect(original.url).toContain("source.example.com");
  expect(registered).toHaveBeenCalledTimes(2);
  expect(downloadToTempFile).toHaveBeenCalledWith(original.url, undefined, 32 * 1024 * 1024);
});

it("deduplicates identical shared and override transformations", async () => {
  const content: ImageFitContent = { media: [media("same")], accountOverrides: { second: { media: [media("same")] } } };
  await fitRemoteImagesForAccounts(
    content,
    [
      { id: "first", platform: "instagram" },
      { id: "second", platform: "instagram" },
    ],
    "crop",
    "user-1",
  );
  expect(upload).toHaveBeenCalledTimes(1);
  expect(content.media[0].url).toBe(content.accountOverrides!.second.media![0].url);
});

it("keeps all input references unchanged and deletes derivatives when a later transformation fails", async () => {
  const content: ImageFitContent = { media: [media("one"), media("two")] };
  const original = structuredClone(content);
  upload.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(
    fitRemoteImagesForAccounts(content, [{ id: "ig", platform: "instagram" }], "crop", "user-1"),
  ).rejects.toThrow("storage unavailable");
  expect(content).toEqual(original);
  upload
    .mockImplementationOnce(async (_stream, key) => `https://cdn.example.com/${key}`)
    .mockRejectedValueOnce(new Error("second upload failed"));
  await expect(
    fitRemoteImagesForAccounts(content, [{ id: "ig", platform: "instagram" }], "blur", "user-1"),
  ).rejects.toThrow("second upload failed");
  expect(content).toEqual(original);
  expect(remove).toHaveBeenCalledTimes(1);
});

it("fits follow-up images for thread-capable accounts and skips unused media", async () => {
  const content: ImageFitContent = { media: [], thread: [{ message: "reply", media: [media("thread")] }] };
  await fitRemoteImagesForAccounts(content, [{ id: "ig", platform: "instagram" }], "crop", "user-1");
  expect(downloadToTempFile).not.toHaveBeenCalled();
});
