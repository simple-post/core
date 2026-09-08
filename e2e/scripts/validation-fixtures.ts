import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export async function validationFixtures(dir: string) {
  await mkdir(dir, { recursive: true });
  for (const [filename, width, height] of [
    ["narrow-image.jpg", 540, 1080],
    ["large-image.jpg", 6020, 6020],
  ] as const)
    await sharp({ create: { width, height, channels: 3, background: "#2596be" } })
      .jpeg()
      .toFile(path.join(dir, filename));
  for (const [filename, rate, duration, codec, format] of [
    ["square-video.mp4", "30", "4", "libx264", "mp4"],
    ["short-video.mp4", "30", "1", "libx264", "mp4"],
    ["slow-video.mp4", "15", "4", "libx264", "mp4"],
    // Deliberately false suffix: measured container must win over the name.
    ["disguised-video.mp4", "30", "1", "libvpx-vp9", "webm"],
  ]) {
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=blue:s=${filename === "square-video.mp4" ? "360x360" : "360x640"}:r=${rate}`,
        "-t",
        duration,
        "-c:v",
        codec,
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-f",
        format,
        path.join(dir, filename),
      ],
      { encoding: "utf8" },
    );
    if (result.error || result.status !== 0)
      throw new Error(`Fixture encoding failed: ${result.error?.message ?? result.stderr}`);
  }
}
