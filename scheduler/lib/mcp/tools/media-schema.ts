import crypto from "node:crypto";

import { z } from "zod";

import type { MediaFile } from "@/types";

export const mcpMediaItemSchema = z.object({
  type: z.enum(["image", "video"]).describe("Media kind."),
  url: z
    .string()
    .url()
    .describe("Public URL of the media. Either a URL the user provided, or a URL returned by the upload_media tool."),
  thumbnailUrl: z.string().url().optional().describe("Optional public thumbnail URL. Recommended for videos."),
});

export type McpMediaItem = z.infer<typeof mcpMediaItemSchema>;

export function toMediaFiles(items: McpMediaItem[] | undefined): MediaFile[] {
  if (!items || items.length === 0) return [];

  return items.map((item) => {
    const filename = (() => {
      try {
        const path = new URL(item.url).pathname;
        const last = path.split("/").pop();
        return last && last.length > 0 ? decodeURIComponent(last) : "media";
      } catch {
        return "media";
      }
    })();

    return {
      id: crypto.randomUUID(),
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      type: item.type,
      filename,
      size: 0,
    };
  });
}
