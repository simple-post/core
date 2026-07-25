import { countAccountsByPlatform, getPlatformName, normalizePlatformId } from "@/lib/config";

describe("normalizePlatformId", () => {
  it("collapses the pre-rename twitter id onto x", () => {
    expect(normalizePlatformId("twitter")).toBe("x");
    expect(normalizePlatformId("Twitter")).toBe("x");
  });

  it("lowercases anything else without rewriting it", () => {
    expect(normalizePlatformId("LinkedIn")).toBe("linkedin");
    expect(normalizePlatformId("bluesky")).toBe("bluesky");
  });
});

describe("getPlatformName", () => {
  it("labels legacy ids with the current platform name", () => {
    expect(getPlatformName("twitter")).toBe("X (Twitter)");
    expect(getPlatformName("x")).toBe("X (Twitter)");
  });

  it("falls back to the normalized id for unknown platforms", () => {
    expect(getPlatformName("Mastodon")).toBe("mastodon");
  });
});

describe("countAccountsByPlatform", () => {
  it("counts each account separately and merges legacy ids", () => {
    expect(
      countAccountsByPlatform([{ platform: "x" }, { platform: "twitter" }, { platform: "bluesky" }, { platform: "x" }]),
    ).toEqual({ x: 3, bluesky: 1 });
  });

  it("treats a missing list as no usage", () => {
    expect(countAccountsByPlatform(undefined)).toEqual({});
  });
});
