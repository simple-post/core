import {
  getUniquePreviewPlatformIds,
  normalizePreviewTitle,
  PREVIEW_FRAME_SIZE,
  PREVIEW_PLATFORM_IDS,
} from "@/lib/platform-preview";

describe("platform preview", () => {
  it("covers every scheduler platform", () => {
    expect(PREVIEW_PLATFORM_IDS).toEqual([
      "x",
      "instagram",
      "facebook",
      "tiktok",
      "youtube",
      "bluesky",
      "threads",
      "linkedin",
      "pinterest",
      "telegram",
      "forem",
    ]);
  });

  it("keeps first-selection order while deduplicating aliases", () => {
    expect(getUniquePreviewPlatformIds(["instagram", "twitter", "x", "telegram", "unknown"])).toEqual([
      "instagram",
      "x",
      "telegram",
    ]);
  });

  it("uses one stable preview frame and content size for every renderer", () => {
    expect(PREVIEW_FRAME_SIZE).toEqual({
      contentWidth: 390,
      width: 390,
    });
  });

  it("normalizes markdown headings for article-style preview titles", () => {
    expect(normalizePreviewTitle("# Launch notes\n\nBody text", "Fallback")).toBe("Launch notes");
    expect(normalizePreviewTitle("### Deep dive", "Fallback")).toBe("Deep dive");
    expect(normalizePreviewTitle("   \n  Plain title  ", "Fallback")).toBe("Plain title");
    expect(normalizePreviewTitle(undefined, "Fallback")).toBe("Fallback");
  });
});
