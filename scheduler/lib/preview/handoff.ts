/** v1 text-only contract shared with website-social/lib/preview-handoff.ts. */
export interface PreviewVariant {
  platform: string;
  message: string;
  thread: string[];
}
export interface PreviewHandoff {
  version: 1;
  variants: PreviewVariant[];
  hasMedia: boolean;
}
export const PREVIEW_KEY = "simplepost:preview:v1:";
export const PREVIEW_TTL = 24 * 60 * 60 * 1000;
const PLATFORMS = new Set([
  "x",
  "linkedin",
  "instagram",
  "facebook",
  "threads",
  "bluesky",
  "forem",
  "tiktok",
  "youtube",
  "pinterest",
  "telegram",
]);
export function parsePreview(value: unknown): PreviewHandoff {
  if (!value || typeof value !== "object") throw new Error("Invalid preview");
  const data = value as Partial<PreviewHandoff>;
  if (
    data.version !== 1 ||
    typeof data.hasMedia !== "boolean" ||
    !Array.isArray(data.variants) ||
    data.variants.length === 0 ||
    data.variants.length > 11
  )
    throw new Error("Invalid preview");
  const seen = new Set<string>();
  const variants = data.variants.map((variant) => {
    if (
      !variant ||
      !PLATFORMS.has(variant.platform) ||
      seen.has(variant.platform) ||
      typeof variant.message !== "string" ||
      variant.message.length > 10_000 ||
      !Array.isArray(variant.thread) ||
      variant.thread.length > 19 ||
      variant.thread.some((message) => typeof message !== "string" || message.length > 10_000)
    )
      throw new Error("Invalid preview");
    seen.add(variant.platform);
    return { platform: variant.platform, message: variant.message, thread: [...variant.thread] };
  });
  const result: PreviewHandoff = { version: 1, hasMedia: data.hasMedia, variants };
  if (JSON.stringify(result).length > 48_000) throw new Error("Preview is too large");
  return result;
}
export function decodePreview(fragment: string): PreviewHandoff {
  if (!fragment.startsWith("#preview=") || fragment.length > 300_000) throw new Error("Invalid preview link");
  return parsePreview(JSON.parse(decodeURIComponent(fragment.slice(9))));
}
export function readStoredPreview(raw: string, now = Date.now()): PreviewHandoff {
  const stored = JSON.parse(raw);
  if (typeof stored.expiresAt !== "number" || stored.expiresAt <= now || stored.expiresAt > now + PREVIEW_TTL)
    throw new Error("This preview has expired. Open it again from the preview tool.");
  return parsePreview(stored.preview);
}
