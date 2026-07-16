export const PREVIEW_FRAME_SIZE = {
  contentWidth: 390,
  width: 390,
} as const;

export const PREVIEW_PLATFORM_IDS = [
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
] as const;

const previewPlatformIdSet = new Set<string>(PREVIEW_PLATFORM_IDS);

export function normalizePreviewPlatform(platform: string): string {
  return platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
}

export function getUniquePreviewPlatformIds(platforms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of platforms) {
    const platform = normalizePreviewPlatform(value);
    if (previewPlatformIdSet.has(platform) && !seen.has(platform)) {
      seen.add(platform);
      result.push(platform);
    }
  }

  return result;
}

export function normalizePreviewTitle(value: string | undefined, fallback: string) {
  const title =
    value
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean) || fallback;

  return title.replace(/^#+\s*/, "") || fallback;
}
