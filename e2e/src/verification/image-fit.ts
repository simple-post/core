import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { LiveConfig } from "../config.js";
import { mediaFiles } from "../media.js";
import type { Materialized, MediaKey } from "../types.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function sample(bytes: Buffer, left: number, top: number) {
  // stats() reads its input, ignoring queued operations such as extract().
  // Materialize the patch first so these assertions measure local markers.
  const { data, info } = await sharp(bytes)
    .extract({ left, top, width: 10, height: 10 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return sharp(data, { raw: info }).stats();
}

// Independent observable contracts, not the application's fitting implementation.
export async function assertFittedBytes(bytes: Buffer, source: Buffer, key: MediaKey, s: Materialized) {
  const original = await sharp(source).metadata();
  const actual = await sharp(bytes).metadata();
  expect(actual.width).toBeGreaterThan(0);
  expect(actual.height).toBeGreaterThan(0);
  if (key === "image" || key === "image2") {
    expect(hash(bytes), "Compatible images must remain byte-for-byte unchanged").toBe(hash(source));
    return actual;
  }
  expect(hash(bytes), "The incompatible source must actually change").not.toBe(hash(source));
  expect(actual.format, "Fitted images must be real JPEG bytes").toBe("jpeg");
  if (s.platform === "instagram") {
    expect(actual.width! / actual.height!).toBeGreaterThanOrEqual(0.8);
    expect(actual.width! / actual.height!).toBeLessThanOrEqual(1.91);
    expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
  }
  if (key === "fitPortrait") {
    expect([actual.width, actual.height], "Crop trims edges; blur retains the complete source height").toEqual(
      s.imageFit === "crop" ? [540, 675] : [864, 1080],
    );
    for (const [y, color] of [
      [0.05, s.imageFit === "crop" ? [37, 150, 190] : [220, 30, 30]],
      [0.5, [37, 150, 190]],
      [0.95, s.imageFit === "crop" ? [37, 150, 190] : [246, 190, 0]],
    ] as const) {
      const { channels } = await sample(bytes, Math.floor(actual.width! / 2) - 5, Math.floor(actual.height! * y) - 5);
      color.forEach((value, c) =>
        expect(Math.abs(channels[c].mean - value), "Fitting must preserve/crop the expected edge markers").toBeLessThan(
          25,
        ),
      );
    }
  }
  if (key === "fitPortrait" && s.imageFit === "blur") {
    for (const left of [5, actual.width! - 15]) {
      const { channels } = await sample(bytes, left, Math.floor(actual.height! / 2));
      [37, 150, 190].forEach((value, c) =>
        expect(
          Math.abs(channels[c].mean - value),
          "Padding must use the source background, not blank bars",
        ).toBeLessThan(25),
      );
    }
  }
  if (s.platform === "telegram") {
    expect(original.width! + original.height!, "Fixture must exceed the original size limit").toBeGreaterThan(10_000);
    expect(actual.width! + actual.height!).toBeLessThanOrEqual(10_000);
  }
  if (s.platform === "tiktok") {
    expect(Math.max(original.width!, original.height!)).toBeGreaterThan(1920);
    expect(Math.min(actual.width!, actual.height!)).toBeLessThanOrEqual(1080);
    expect(Math.max(actual.width!, actual.height!)).toBeLessThanOrEqual(1920);
  }
  if (s.platform === "linkedin") {
    expect(original.width! * original.height!).toBeGreaterThan(36_152_319);
    expect(actual.width! * actual.height!).toBeLessThanOrEqual(36_152_319);
  }
  if (key === "fitNoise") {
    expect(source.length, "Compression fixture must exceed the provider byte cap").toBeGreaterThan(2_000_000);
    expect(bytes.length).toBeLessThanOrEqual(2_000_000);
  }
  return actual;
}

export async function verifyFittedMedia(
  config: LiveConfig,
  s: Materialized,
  media: Array<{ url: string; size?: number }>,
) {
  const sources = await mediaFiles(config, s.media);
  expect(media, "Fitting must preserve attachment count/order").toHaveLength(sources.length);
  const evidence = [];
  for (const [index, item] of media.entries()) {
    const url = new URL(item.url);
    expect(url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)).toBe(true);
    const response = await fetch(item.url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    expect(response.ok, "Persisted fitted image must be downloadable").toBe(true);
    const bytes = Buffer.from(await response.arrayBuffer());
    const source = await readFile(sources[index].path);
    const metadata = await assertFittedBytes(bytes, source, s.media[index], s);
    expect(item.size, "Saved size must describe the derivative, not the original").toBe(bytes.length);
    evidence.push({
      index,
      sourceSha256: hash(source),
      fittedSha256: hash(bytes),
      width: metadata.width,
      height: metadata.height,
      size: bytes.length,
    });
  }
  return evidence;
}
