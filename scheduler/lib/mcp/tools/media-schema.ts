import crypto from "node:crypto";

import { MAX_THREAD_SEGMENTS } from "@simple-post/sdk";
import { z } from "zod";

import type { MediaFile, ThreadSegment } from "@/types";

function createMcpMediaItemSchema() {
  return z.object({
    type: z.enum(["image", "video"]).describe("Media kind."),
    url: z
      .string()
      .url()
      .describe("Public URL of the media. Either a URL the user provided, or a URL returned by the upload_media tool."),
    thumbnailUrl: z.string().url().optional().describe("Optional public thumbnail URL. Recommended for videos."),
  });
}

function createMcpMediaArraySchema(description: string) {
  return z.array(createMcpMediaItemSchema()).describe(description);
}

export const mcpMediaItemSchema = createMcpMediaItemSchema();

export type McpMediaItem = z.infer<typeof mcpMediaItemSchema>;

export const mcpMediaArraySchema = createMcpMediaArraySchema(
  'Media items. Each item must be an object with required fields {"type":"image"|"video","url":"https://..."} and optional "thumbnailUrl".',
);

/** Follow-up text segments after the root post. Segment media is intentionally omitted from MCP inputs. */
export const mcpThreadSegmentSchema = z.object({
  message: z
    .string()
    .describe(
      "Text for this segment. It is published as a reply after the previous segment (chained on X, Bluesky, Threads, Telegram).",
    ),
});

export const mcpThreadArraySchema = z
  .array(mcpThreadSegmentSchema)
  .max(MAX_THREAD_SEGMENTS)
  .describe(
    `Follow-up text-only thread segments after the root post, in order (max ${MAX_THREAD_SEGMENTS}). Each segment is {"message":"..."}. Use root media for any image or video attachments.`,
  );

export const mcpThreadSchema = mcpThreadArraySchema
  .optional()
  .describe(
    `Additional text-only posts after the root, in order (max ${MAX_THREAD_SEGMENTS}). Each thread segment has required "message". Use the root "media" field for image/video attachments. Only thread-capable platforms (x, bluesky, threads, telegram) publish every segment; others get a validation warning and only the root is sent.`,
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

/** Maps MCP text-only thread input to SDK thread segments. */
export function toThreadSegments(segments: McpThreadSegment[] | undefined): ThreadSegment[] {
  if (!segments?.length) return [];
  return segments.map((segment) => ({
    message: segment.message ?? "",
  }));
}
