import crypto from "node:crypto";

import { MAX_THREAD_SEGMENTS } from "@simple-post/sdk";
import { z } from "zod";

import type { MediaFile, ThreadSegment } from "@/types";

export const mcpMediaItemSchema = z.object({
  type: z.enum(["image", "video"]).describe("Media kind."),
  url: z
    .string()
    .url()
    .describe("Public URL of the media. Either a URL the user provided, or a URL returned by the upload_media tool."),
  thumbnailUrl: z.string().url().optional().describe("Optional public thumbnail URL. Recommended for videos."),
});

export type McpMediaItem = z.infer<typeof mcpMediaItemSchema>;

/** Follow-up segments after the root post; same shape as the REST API `thread` field. */
export const mcpThreadSegmentSchema = z.object({
  message: z
    .string()
    .describe(
      "Text for this segment. It is published as a reply after the previous segment (chained on X, Bluesky, Threads, Telegram).",
    ),
  media: z
    .array(mcpMediaItemSchema)
    .optional()
    .describe("Optional images/videos for this segment only. Same URL rules as the root `media` field."),
});

export const mcpThreadSchema = z
  .array(mcpThreadSegmentSchema)
  .max(MAX_THREAD_SEGMENTS)
  .optional()
  .describe(
    `Additional posts after the root, in order (max ${MAX_THREAD_SEGMENTS}). Only thread-capable platforms (x, bluesky, threads, telegram) publish every segment; others get a validation warning and only the root is sent.`,
  );

export type McpThreadSegment = z.infer<typeof mcpThreadSegmentSchema>;

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

/** Maps MCP thread input (with lightweight media items) to SDK thread segments (full MediaFile rows). */
export function toThreadSegments(segments: McpThreadSegment[] | undefined): ThreadSegment[] {
  if (!segments?.length) return [];
  return segments.map((segment) => ({
    message: segment.message ?? "",
    media: toMediaFiles(segment.media),
  }));
}
