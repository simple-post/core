import { unlink } from "node:fs/promises";

import { downloadToTempFile } from "@simple-post/sdk";
import sharp from "sharp";

import type { AccountOverridesMap, MediaFile, ValidationIssue } from "@simple-post/sdk";

/** Inspect actual photo bytes; caller-provided dimensions cannot establish eligibility. */
export async function validateInstagramPhotoDimensions(params: {
  media: MediaFile[];
  accounts: Array<{ id: string; platform: string }>;
  accountOverrides?: AccountOverridesMap;
}): Promise<ValidationIssue[]> {
  const results: ValidationIssue[] = [];
  const inspections = new Map<string, { width: number; height: number } | null>();
  for (const account of params.accounts) {
    if (account.platform.toLowerCase() !== "instagram") continue;
    const media = params.accountOverrides?.[account.id]?.media ?? params.media;
    for (const [index, item] of media.entries()) {
      if (item.type !== "image") continue;
      if (!inspections.has(item.url)) {
        let file: string | undefined;
        try {
          file = await downloadToTempFile(item.url, undefined, 8 * 1024 * 1024);
          const metadata = await sharp(file).metadata();
          inspections.set(
            item.url,
            metadata.width && metadata.height
              ? metadata.orientation && metadata.orientation >= 5
                ? { width: metadata.height, height: metadata.width }
                : { width: metadata.width, height: metadata.height }
              : null,
          );
        } catch {
          inspections.set(item.url, null);
        } finally {
          if (file) await unlink(file).catch(() => undefined);
        }
      }
      const dimensions = inspections.get(item.url);
      const unsupportedRatio =
        dimensions && (dimensions.width / dimensions.height < 0.8 || dimensions.width / dimensions.height > 1.91);
      if (!dimensions || unsupportedRatio) {
        results.push({
          platform: "instagram",
          severity: "error",
          code: dimensions ? "photo_aspect_ratio_unsupported" : "photo_dimensions_unavailable",
          message: dimensions
            ? `Instagram photo ${index + 1} is ${dimensions.width}×${dimensions.height}. Crop or pad it to an aspect ratio between 4:5 and 1.91:1 (for example, 1080×1350) before scheduling or publishing. SimplePost does not crop it automatically.`
            : `SimplePost couldn't inspect Instagram photo ${index + 1}. Use a publicly accessible JPEG image under 8 MB.`,
          field: `text.media[${index}]`,
          meta: { accountId: account.id, ...dimensions },
        });
      }
    }
  }
  return results;
}
