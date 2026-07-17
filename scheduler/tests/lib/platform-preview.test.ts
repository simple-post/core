import { getPlatformById, SOCIAL_PLATFORM_IDS } from "@/lib/config";
import {
  getUniquePreviewPlatforms,
  normalizePreviewPlatform,
  PREVIEW_FRAME_WIDTH,
  PREVIEW_PLATFORMS,
} from "@/lib/platform-preview";

describe("platform preview", () => {
  it("previews every scheduler platform", () => {
    for (const platformId of SOCIAL_PLATFORM_IDS) {
      expect(normalizePreviewPlatform(platformId)).toBe(platformId);
    }
  });

  it("maps every previewable platform to scheduler platform config", () => {
    for (const platform of PREVIEW_PLATFORMS) {
      expect(getPlatformById(platform)).toBeDefined();
    }
  });

  it("keeps first-selection order while deduplicating aliases and dropping unknowns", () => {
    expect(getUniquePreviewPlatforms(["instagram", "twitter", "x", "telegram", "unknown"])).toEqual([
      "instagram",
      "x",
      "telegram",
    ]);
  });

  it("matches the renderer's default frame width", () => {
    expect(PREVIEW_FRAME_WIDTH).toBe(390);
  });
});
