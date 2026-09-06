import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
const dir = path.resolve("fixtures/generated");
await mkdir(dir, { recursive: true });
function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.error || r.status !== 0)
    throw new Error(`Install ffmpeg to regenerate fixtures: ${r.error?.message ?? r.stderr}`);
}
for (const [file, color] of [
  ["image.jpg", "#2596be"],
  ["image-2.jpg", "#f6be00"],
  ["image.webp", "#2596be"],
])
  await sharp({ create: { width: 1080, height: 1080, channels: 3, background: color } }).toFile(path.join(dir, file));
for (const sound of [true, false]) {
  const args = ["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24"];
  if (sound) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100");
  args.push(
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  );
  if (sound) args.push("-c:a", "aac", "-b:a", "64k", "-shortest");
  else args.push("-an");
  ffmpeg([...args, path.join(dir, sound ? "video.mp4" : "silent-video.mp4")]);
}
const manifest: Record<string, unknown> = {};
for (const file of ["image.jpg", "image-2.jpg", "image.webp", "video.mp4", "silent-video.mp4"]) {
  const bytes = await readFile(path.join(dir, file));
  manifest[file] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Generated original color images and four-second test videos (with tone / without audio).");
