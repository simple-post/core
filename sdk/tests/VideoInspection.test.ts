import { mkdtemp, copyFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectLocalMedia } from "../src/utils/media-inspection";
import { validatePostMedia } from "../src/utils/post-media-validation";

// eslint-disable-next-line unicorn/prefer-module -- Jest runs these tests as CommonJS.
const fixtures = path.join(__dirname, "fixtures");

it("probes actual codecs, dimensions and frame rate and enforces platform differences", async () => {
  const file = path.join(fixtures, "portrait.mp4");
  const inspection = await inspectLocalMedia(file);
  expect(inspection.video).toMatchObject({
    width: 360,
    height: 640,
    fps: 30,
    durationSec: 4,
    codec: "h264",
    pixelFormat: "yuv420p",
  });
  const media = { type: "video" as const, path: file, durationSec: 999_999, size: 1, contentType: "video/webm" };
  const issues = await validatePostMedia({
    platforms: ["tiktok", "youtube", "x"],
    content: { media: [media] },
    options: { tiktok: { privacyLevel: "SELF_ONLY" } },
  });
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(media).toMatchObject({ durationSec: 4, contentType: "video/mp4" });
  expect(media.size).toBeGreaterThan(1);
  const slow = await validatePostMedia({
    platforms: ["tiktok", "bluesky"],
    content: { media: [{ type: "video", path: path.join(fixtures, "slow.webm") }] },
  });
  expect(slow).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ platform: "tiktok", code: "media_frames_per_second_unsupported", actual: 15 }),
      expect.objectContaining({ platform: "bluesky", code: "video_format_unsupported" }),
    ]),
  );
});

it("detects container bytes despite renamed files and rejects a fake MP4 header", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "probe-test-"));
  try {
    const renamed = path.join(dir, "renamed.webm");
    await copyFile(path.join(fixtures, "portrait.mp4"), renamed);
    const renamedInspection = await inspectLocalMedia(renamed);
    expect(renamedInspection.contentType).toBe("video/mp4");
    const corrupt = path.join(dir, "fake.mp4");
    const prefix = Buffer.alloc(4096);
    prefix.write("ftypisom", 4);
    await writeFile(corrupt, prefix);
    await expect(inspectLocalMedia(corrupt)).rejects.toMatchObject({ code: "media_unavailable" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
