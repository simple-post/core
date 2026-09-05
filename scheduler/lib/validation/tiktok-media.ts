import { unlink } from "node:fs/promises";

import { downloadToTempFile } from "@simple-post/sdk";
import sharp from "sharp";

import type { AccountOverridesMap, MediaFile, ValidationIssue } from "@simple-post/sdk";

/** Inspect actual photo bytes; caller-provided dimensions cannot establish eligibility. */
export async function validateTikTokPhotoDimensions(params: {
  media: MediaFile[];
  accounts: Array<{ id: string; platform: string }>;
  accountOverrides?: AccountOverridesMap;
}): Promise<ValidationIssue[]> {
  const results: ValidationIssue[] = [];
  const inspections = new Map<string, { width: number; height: number } | null>();
  for (const account of params.accounts) {
    if (account.platform.toLowerCase() !== "tiktok") continue;
    const media = params.accountOverrides?.[account.id]?.media ?? params.media;
    for (const [index, item] of media.entries()) {
      if (item.type !== "image") continue;
      if (!inspections.has(item.url)) {
        let file: string | undefined;
        try {
          file = await downloadToTempFile(item.url, undefined, 20 * 1024 * 1024);
          const metadata = await sharp(file).metadata();
          inspections.set(
            item.url,
            metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : null,
          );
        } catch {
          inspections.set(item.url, null);
        } finally {
          if (file) await unlink(file).catch(() => undefined);
        }
      }
      const dimensions = inspections.get(item.url);
      const tooLarge =
        dimensions &&
        (Math.min(dimensions.width, dimensions.height) > 1080 || Math.max(dimensions.width, dimensions.height) > 1920);
      if (!dimensions || tooLarge) {
        results.push({
          platform: "tiktok",
          severity: "error",
          code: dimensions ? "photo_dimensions_too_large" : "photo_dimensions_unavailable",
          message: dimensions
            ? `TikTok photo ${index + 1} is ${dimensions.width}×${dimensions.height}. Resize it to fit within 1080×1920 (portrait) or 1920×1080 (landscape), preserving its aspect ratio.`
            : `SimplePost couldn't inspect TikTok photo ${index + 1}. Use a publicly accessible JPEG or WebP image under 20 MB.`,
          field: `text.media[${index}]`,
          meta: { accountId: account.id, ...dimensions },
        });
      }
    }
  }
  return results;
}
