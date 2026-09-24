import sharp from "sharp";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export async function imageFitFixtures(dir: string) {
  await mkdir(dir, { recursive: true });
  // Edge markers distinguish actual cropping from padding. Solid-color images cannot.
  const portrait = Buffer.alloc(540 * 1080 * 3);
  for (let y = 0; y < 1080; y++)
    for (let x = 0; x < 540; x++) {
      const color = y < 150 ? [220, 30, 30] : y >= 930 ? [246, 190, 0] : [37, 150, 190];
      portrait.set(color, (y * 540 + x) * 3);
    }
  await sharp(portrait, { raw: { width: 540, height: 1080, channels: 3 } })
    .jpeg({ quality: 100 })
    .toFile(path.join(dir, "fit-portrait.jpg"));
  // Deterministic high-entropy edges exceed Bluesky's byte cap. Keep the centre
  // blue for native-platform identity checks even after lossy recompression.
  const noise = Buffer.alloc(2000 * 2000 * 3);
  let seed = 123456789;
  for (let y = 0; y < 2000; y++)
    for (let x = 0; x < 2000; x++)
      for (let c = 0; c < 3; c++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        noise[(y * 2000 + x) * 3 + c] = x >= 400 && x < 1600 && y >= 400 && y < 1600 ? [37, 150, 190][c] : seed & 255;
      }
  await sharp(noise, { raw: { width: 2000, height: 2000, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toFile(path.join(dir, "fit-noise.jpg"));
}
