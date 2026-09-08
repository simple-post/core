import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { Publisher } from "../src/publishers/base";
import { PostErrorType } from "../src/types";

import type { Content, Platform } from "../src/types/post";
import type { ValidationIssue } from "../src/types/validation";

class RecordingPublisher extends Publisher {
  attempts = 0;
  checks = 0;
  issues: ValidationIssue[] = [];
  constructor(platform: Platform) {
    super(platform, { common: { logLevel: "none" } }, platform);
  }
  async validateReadiness() {
    this.checks++;
    return this.issues;
  }
  async postContent(_content: Content) {
    this.attempts++;
    return { id: "test", error: PostErrorType.NO_ERROR };
  }
}
it("blocks a real invalid Instagram image before both the readiness and publishing calls", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "boundary-"));
  try {
    const file = path.join(dir, "portrait.jpg");
    await sharp({ create: { width: 540, height: 1080, channels: 3, background: "black" } })
      .jpeg()
      .toFile(file);
    const publisher = new RecordingPublisher("instagram");
    const result = await publisher.post({ media: [{ type: "image", path: file }] });
    expect(result.error).toBe(PostErrorType.INVALID_CONTENT);
    expect(result.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "media_aspect_ratio_unsupported", field: "media[0]" })]),
    );
    expect(publisher.attempts).toBe(0);
    expect(publisher.checks).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rechecks live eligibility for each send without caching authorization", async () => {
  const publisher = new RecordingPublisher("bluesky");
  const first = await publisher.post({ text: "ok" });
  expect(first.error).toBe(PostErrorType.NO_ERROR);
  publisher.issues = [
    { platform: "bluesky", severity: "error", code: "account_ineligible", message: "Account is restricted" },
  ];
  const second = await publisher.post({ text: "ok again" });
  expect(second.error).toBe(PostErrorType.INVALID_CONTENT);
  expect(publisher.attempts).toBe(1);
  expect(publisher.checks).toBe(2);
});
