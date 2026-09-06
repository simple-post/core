import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import axios from "axios";
import sharp from "sharp";

import { inspectLocalMedia, inspectRemoteMedia } from "../src/utils/media-inspection";

jest.mock("axios");
const get = jest.mocked(axios.get);
let jpeg: Buffer;
let png: Buffer;
beforeAll(async () => {
  const source = { create: { width: 32, height: 32, channels: 3 as const, background: "red" } };
  jpeg = await sharp(source).jpeg().toBuffer();
  png = await sharp(source).png().toBuffer();
});
beforeEach(() => jest.clearAllMocks());
function serve(bytes: Buffer, contentType?: string, size: number | undefined = bytes.length) {
  const stream = Readable.from([bytes]);
  get.mockResolvedValueOnce({
    status: 200,
    headers: { "content-type": contentType, "content-length": size },
    data: stream,
  });
  return stream;
}

it("rejects a successful HTTP response containing a Google sign-in page", async () => {
  const stream = serve(Buffer.from("<!doctype html><html>Sign in to Google</html>"), "text/html; charset=utf-8");
  await expect(inspectRemoteMedia("https://drive.google.com/uc?export=download&id=private")).rejects.toMatchObject({
    code: "media_invalid",
  });
  expect(stream.destroyed).toBe(true);
});
it("rejects HTML disguised as an image and a forged image extension", async () => {
  serve(Buffer.from("<!doctype html><html>Access denied</html>"), "image/jpeg");
  await expect(inspectRemoteMedia("https://example.com/photo.jpg")).rejects.toMatchObject({ code: "media_invalid" });
});
it("decodes image bytes with a generic content type and no filename", async () => {
  serve(jpeg, "application/octet-stream");
  await expect(inspectRemoteMedia("https://example.com/download?id=1")).resolves.toMatchObject({
    size: jpeg.length,
    contentType: "image/jpeg",
    width: 32,
    height: 32,
  });
});
it("accepts a chunked image without Content-Length", async () => {
  const stream = Readable.from([png.subarray(0, 4), png.subarray(4, 10), png.subarray(10)]);
  get.mockResolvedValueOnce({ status: 200, headers: { "content-type": "image/png" }, data: stream });
  await expect(inspectRemoteMedia("https://example.com/image")).resolves.toMatchObject({
    size: png.length,
    contentType: "image/png",
  });
});
it("rejects a truncated image even with a valid signature", async () => {
  serve(jpeg.subarray(0, 100), "image/jpeg");
  await expect(inspectRemoteMedia("https://example.com/photo.jpg")).rejects.toMatchObject({ code: "image_invalid" });
});
it("rejects mismatched response MIME types", async () => {
  serve(png, "image/jpeg");
  await expect(inspectRemoteMedia("https://example.com/photo.jpg")).rejects.toMatchObject({
    code: "media_type_mismatch",
  });
});
it("rejects an incomplete response even if the downloaded image decodes", async () => {
  serve(jpeg, "image/jpeg", jpeg.length + 10);
  await expect(inspectRemoteMedia("https://example.com/photo.jpg")).rejects.toMatchObject({ code: "media_incomplete" });
});
it.each([401, 403, 404, 500])("rejects HTTP %s with an actionable error", async (status) => {
  get.mockRejectedValueOnce({ response: { status } });
  await expect(inspectRemoteMedia("https://example.com/image")).rejects.toMatchObject({ code: "media_unavailable" });
});
it("preserves DNS and redirect SSRF protection", async () => {
  serve(jpeg, "image/jpeg");
  await inspectRemoteMedia("https://example.com/image");
  const config = get.mock.calls[0][1]!;
  expect(config.lookup).toEqual(expect.any(Function));
  expect(() =>
    config.beforeRedirect!({ href: "http://169.254.169.254/latest/meta-data" }, {} as never, {} as never),
  ).toThrow();
  await expect(inspectRemoteMedia("http://127.0.0.1/image")).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(1);
});
it("stops reading a large video after inspecting its prefix", async () => {
  const prefix = Buffer.alloc(8192);
  prefix.write("ftypisom", 4);
  const stream = serve(prefix, "video/mp4", 200_000_000);
  await expect(inspectRemoteMedia("https://example.com/video.mp4")).resolves.toMatchObject({
    contentType: "video/mp4",
    size: 200_000_000,
  });
  expect(stream.destroyed).toBe(true);
});
it("inspects local CLI files by bytes rather than extension", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-inspection-"));
  try {
    const file = path.join(dir, "renamed.jpg");
    await writeFile(file, png);
    await expect(inspectLocalMedia(file)).resolves.toMatchObject({ contentType: "image/png", size: png.length });
    await writeFile(file, "<html>Sign in</html>");
    await expect(inspectLocalMedia(file)).rejects.toMatchObject({ code: "media_invalid" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
