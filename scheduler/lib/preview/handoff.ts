/** v1 text-only contract shared with website-social/lib/preview-handoff.ts. */
export interface PreviewVariant {
  platform: string;
  message: string;
  thread: string[];
}
/** Free website tool that produced the draft. Used only as an analytics label. */
export const PREVIEW_SOURCES = ["post-preview", "post-checker", "thread-generator", "cross-post-generator"] as const;
export type PreviewSource = (typeof PREVIEW_SOURCES)[number];
export interface PreviewHandoff {
  version: 1;
  variants: PreviewVariant[];
  hasMedia: boolean;
  /** Optional; unknown values are dropped rather than rejected so older links keep working. */
  source?: PreviewSource;
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
      variant.message.length > 126_412 ||
      !Array.isArray(variant.thread) ||
      variant.thread.length > 24 ||
      variant.thread.some((message) => typeof message !== "string" || message.length > 126_412)
    )
      throw new Error("Invalid preview");
    seen.add(variant.platform);
    return { platform: variant.platform, message: variant.message, thread: [...variant.thread] };
  });
  const result: PreviewHandoff = { version: 1, hasMedia: data.hasMedia, variants };
  if ((PREVIEW_SOURCES as readonly unknown[]).includes(data.source)) result.source = data.source;
  if (JSON.stringify(result).length > 200_000) throw new Error("Preview is too large");
  return result;
}
export function decodePreview(fragment: string): PreviewHandoff {
  if (!fragment.startsWith("#preview=") || fragment.length > 1_800_000) throw new Error("Invalid preview link");
  return parsePreview(JSON.parse(decodeURIComponent(fragment.slice(9))));
}
export function readStoredPreview(raw: string, now = Date.now()): PreviewHandoff {
  const stored = JSON.parse(raw);
  if (typeof stored.expiresAt !== "number" || stored.expiresAt <= now || stored.expiresAt > now + PREVIEW_TTL)
    throw new Error("This preview has expired. Open it again from the preview tool.");
  return parsePreview(stored.preview);
}
