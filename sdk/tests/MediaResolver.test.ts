import fs from "node:fs";

import { downloadToTempFile } from "../src/utils/media";
import { MediaResolver } from "../src/utils/media-resolver";
import { S3MediaUploader } from "../src/utils/s3";

jest.mock("node:fs");
jest.mock("../src/utils/media", () => ({ downloadToTempFile: jest.fn() }));
jest.mock("../src/utils/s3", () => ({ getKeyFromUrl: jest.fn(), S3MediaUploader: jest.fn() }));

const uploadFile = jest.fn();
const deleteFile = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(downloadToTempFile).mockResolvedValue("/tmp/source.jpg");
  jest.mocked(fs.statSync).mockReturnValue({ size: 42, mtimeMs: 1 } as fs.Stats);
  jest.mocked(S3MediaUploader).mockImplementation(() => ({ uploadFile, deleteFile }) as never);
  uploadFile.mockResolvedValue("https://storage.example/temp/source.jpg");
});

it("gives URL publishers a managed copy of the exact downloaded file", async () => {
  const resolver = new MediaResolver();
  const result = await resolver.resolve(
    [{ type: "image", url: "https://files.example/mutable-photo" }],
    ["instagram", "threads", "forem"],
  );

  expect(downloadToTempFile).toHaveBeenCalledTimes(1);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(uploadFile).toHaveBeenCalledWith("/tmp/source.jpg", expect.stringContaining("source.jpg"));
  expect(result).toEqual([
    {
      type: "image",
      path: "/tmp/source.jpg",
      url: "https://storage.example/temp/source.jpg",
    },
  ]);
});

it("materializes remote media for path publishers without re-uploading it", async () => {
  const resolver = new MediaResolver();
  const result = await resolver.resolve([{ type: "image", url: "https://files.example/photo.jpg" }], ["x"]);

  expect(result).toEqual([{ type: "image", path: "/tmp/source.jpg", url: "https://files.example/photo.jpg" }]);
  expect(uploadFile).not.toHaveBeenCalled();
});

it("treats local bytes as authoritative when both a path and an external URL are supplied", async () => {
  const resolver = new MediaResolver();
  const result = await resolver.resolve(
    [{ type: "image", path: "/tmp/source.jpg", url: "https://files.example/different.jpg" }],
    ["instagram"],
  );

  expect(downloadToTempFile).not.toHaveBeenCalled();
  expect(uploadFile).toHaveBeenCalledWith("/tmp/source.jpg", expect.stringContaining("source.jpg"));
  expect(result[0]).toMatchObject({
    path: "/tmp/source.jpg",
    url: "https://storage.example/temp/source.jpg",
  });
});
