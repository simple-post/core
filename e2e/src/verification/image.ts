import { expect } from "@playwright/test";
import sharp from "sharp";

export async function verifyFixtureImage(buffer: Buffer, key: string, label: string) {
  const metadata = await sharp(buffer).metadata();
  const width = Math.max(1, Math.floor(metadata.width! / 2));
  const height = Math.max(1, Math.floor(metadata.height! / 2));
  const stats = await sharp(buffer)
    .extract({ left: Math.floor(metadata.width! / 4), top: Math.floor(metadata.height! / 4), width, height })
    .stats();
  const expected = key === "image2" ? [246, 190, 0] : [37, 150, 190];
  expected.forEach((channel, c) =>
    expect(Math.abs(stats.channels[c].mean - channel), `${label} has the wrong fixture/color`).toBeLessThan(35),
  );
}
