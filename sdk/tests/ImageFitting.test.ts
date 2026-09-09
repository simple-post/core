import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { canFitImageIssue, ImageFitSchema } from "../src/image-fit";
import { fitImage, fitPostImages } from "../src/utils/image-fitting";
import { validatePostMedia } from "../src/utils/post-media-validation";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "image-fit-test-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture(width: number, height: number, format: "jpeg" | "png" = "png") {
  const file = path.join(directory, `${width}-${height}.${format}`);
  await sharp({ create: { width, height, channels: 3, background: "#e53835" } })
    .toFormat(format)
    .toFile(file);
  return file;
}

it.each(["crop", "blur"] as const)(
  "fits a 1:2 PNG for Instagram and TikTok using %s, preserving the source",
  async (mode) => {
    const file = await fixture(1200, 2400);
    const original = await readFile(file);
    const fitted = await fitPostImages(
      { platforms: ["instagram", "tiktok", "bluesky"], content: { media: [{ type: "image", path: file }] } },
      mode,
    );
    try {
      const output = fitted.post.content.media![0];
      const metadata = await sharp(output.path).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width! / metadata.height!).toBeGreaterThanOrEqual(0.8);
      expect(metadata.width! / metadata.height!).toBeLessThanOrEqual(1.91);
      expect(Math.min(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1080);
      expect(output.size).toBeLessThanOrEqual(2_000_000);
      const issues = await validatePostMedia(fitted.post);
      expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
      expect(await readFile(file)).toEqual(original);
    } finally {
      await fitted.cleanup();
    }
    await expect(access(fitted.post.content.media![0].path!)).rejects.toThrow();
  },
);

it("preserves top and bottom content with blurred padding while crop trims it", async () => {
  const file = path.join(directory, "striped.png");
  const stripe = await sharp({ create: { width: 400, height: 100, channels: 3, background: "blue" } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 400, height: 800, channels: 3, background: "red" } })
    .composite([
      { input: stripe, top: 0, left: 0 },
      { input: stripe, top: 700, left: 0 },
    ])
    .png()
    .toFile(file);
  const blur = (await fitImage({ path: file }, ["instagram"], "blur"))!;
  const crop = (await fitImage({ path: file }, ["instagram"], "crop"))!;
  const pixel = async (bytes: Buffer, width: number) =>
    sharp(bytes)
      .extract({ left: Math.floor(width / 2), top: 15, width: 1, height: 1 })
      .raw()
      .toBuffer();
  const blue = await pixel(blur.bytes, blur.width);
  const red = await pixel(crop.bytes, crop.width);
  expect(blue[2]).toBeGreaterThan(200);
  expect(red[0]).toBeGreaterThan(200);
  expect(red[2]).toBeLessThan(30);
});

it("leaves already-compatible files untouched", async () => {
  const file = await fixture(800, 1000, "jpeg");
  await expect(fitImage({ path: file }, ["instagram", "bluesky", "tiktok"], "blur")).resolves.toBeUndefined();
});

it.each(["crop", "blur"] as const)("fits landscape boundaries and Telegram panoramas with %s", async (mode) => {
  const file = await fixture(4000, 100);
  const result = (await fitImage({ path: file }, ["instagram", "telegram"], mode))!;
  expect(result.width / result.height).toBeLessThanOrEqual(1.91);
  expect(result.width / result.height).toBeGreaterThanOrEqual(0.8);
  expect(result.width + result.height).toBeLessThanOrEqual(10_000);
});

it("respects EXIF orientation before choosing crop dimensions", async () => {
  const file = path.join(directory, "rotated.jpg");
  await sharp({ create: { width: 1600, height: 800, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(file);
  const fitted = (await fitImage({ path: file }, ["instagram"], "crop"))!;
  expect(fitted.width).toBe(800);
  expect(fitted.height).toBe(1000);
  const metadata = await sharp(fitted.bytes).metadata();
  expect(metadata.orientation).toBeUndefined();
});

it("compresses noisy images below the strictest byte limit", async () => {
  const { randomBytes } = await import("node:crypto");
  const file = path.join(directory, "noise.png");
  await sharp(randomBytes(1800 * 1800 * 3), { raw: { width: 1800, height: 1800, channels: 3 } })
    .png()
    .toFile(file);
  const result = (await fitImage({ path: file }, ["bluesky", "facebook"], "crop"))!;
  expect(result.bytes.length).toBeLessThanOrEqual(2_000_000);
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.format).toBe("jpeg");
});

it("rejects corrupt files and unknown modes without altering the source", async () => {
  const file = path.join(directory, "broken.png");
  await writeFile(file, "not an image");
  await expect(fitImage({ path: file }, ["instagram"], "crop")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("not an image");
  expect(ImageFitSchema.safeParse("stretch").success).toBe(false);
});

it("does not offer fitting for attachment counts or mixed-media errors", () => {
  expect(canFitImageIssue({ code: "too_many_images" })).toBe(false);
  expect(canFitImageIssue({ code: "mixed_media_not_supported" })).toBe(false);
  expect(canFitImageIssue({ code: "image_format_unsupported" })).toBe(true);
});
