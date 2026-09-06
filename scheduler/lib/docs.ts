export const DOCS_ORIGIN = "https://docs.simplepost.social";

export function docsUrl(path = "/getting-started"): string {
  return `${DOCS_ORIGIN}${path}`;
}

export function platformHelpPath(platform: string): string {
  const normalized = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  const supported = new Set([
    "x",
    "instagram",
    "facebook",
    "threads",
    "linkedin",
    "bluesky",
    "tiktok",
    "youtube",
    "pinterest",
    "telegram",
  ]);
  if (normalized === "forem") return "/forem";
  return supported.has(normalized) ? `/accounts#${normalized}` : "/accounts";
}
