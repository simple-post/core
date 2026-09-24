import crypto from "node:crypto";

import { MAX_THREAD_SEGMENTS } from "@simple-post/sdk";
import { z } from "zod";

import type { AccountOverridesMap, MediaFile, ThreadSegment } from "@/types";

function createMcpMediaItemSchema() {
  return z.object({
    type: z
      .enum(["image", "video"])
      .describe(
        "Media kind. Bluesky accepts up to 4 images or one MP4 video (300 MB, 10 minutes); images and video cannot be mixed.",
      ),
    url: z
      .string()
      .url()
      .describe(
        "Public URL of the media. External URLs are imported into SimplePost storage before the post is saved or published.",
      ),
    thumbnailUrl: z.string().url().optional().describe("Optional public thumbnail URL. Recommended for videos."),
    filename: z.string().min(1).optional().describe("Original filename when known, such as the upload_media result."),
    durationSec: z
      .number()
      .nonnegative()
      .optional()
      .describe("Video duration in seconds, when known, for platform validation."),
    size: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("File size in bytes. Preserve this value when reusing an upload_media result."),
  });
}

function createMcpMediaArraySchema(description: string) {
  return z.array(createMcpMediaItemSchema()).describe(description);
}

export const mcpMediaItemSchema = createMcpMediaItemSchema();

export type McpMediaItem = z.infer<typeof mcpMediaItemSchema>;

export const mcpMediaArraySchema = createMcpMediaArraySchema(
  'Media items. Each item must have {"type":"image"|"video","url":"https://..."}. Preserve optional filename, size, durationSec, and thumbnailUrl values returned by upload_media so platform validation can enforce media limits. Bluesky supports up to 4 images or one MP4 video (300 MB, 10 minutes); images and video cannot be mixed.',
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

export const mcpAccountOverrideSchema = z.object({
  message: z.string().optional().describe("Root post text for this account. Omit to use the shared message."),
  media: mcpMediaArraySchema
    .optional()
    .describe("Root media for this account. Omit to use the shared media; pass [] for no media on this account."),
  thread: mcpThreadArraySchema
    .optional()
    .describe(
      "Follow-up segments for this account only. Omit to use the shared thread; pass [] so this account publishes no follow-ups.",
    ),
});

export const MCP_ACCOUNT_OVERRIDES_DESCRIPTION =
  'Per-account content, keyed by account ID (not platform name). Each field replaces the shared value for that account only; omitted fields fall back to the shared message, media, or thread. Use this to keep platform variants in ONE post instead of creating separate posts, e.g. one long post on X and LinkedIn plus a thread on Bluesky and Threads: put the long text in the shared message with no shared thread, and give each Bluesky/Threads account {"message":"first segment","thread":[{"message":"..."}]}.';

export const mcpAccountOverridesSchema = z.record(z.string(), mcpAccountOverrideSchema);

export type McpAccountOverrides = z.infer<typeof mcpAccountOverridesSchema>;

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
      filename: item.filename ?? filename,
      size: item.size ?? 0,
      ...(item.durationSec === undefined ? {} : { durationSec: item.durationSec }),
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

/**
 * Maps MCP per-account overrides to SDK overrides. Absent fields stay absent,
 * because an absent field means "use the shared value" while [] means "none".
 */
export function toAccountOverrides(overrides: McpAccountOverrides | undefined): AccountOverridesMap | undefined {
  if (!overrides) return undefined;
  const entries = Object.entries(overrides).map(([accountId, override]) => [
    accountId,
    {
      ...(override.message === undefined ? {} : { message: override.message }),
      ...(override.media === undefined ? {} : { media: toMediaFiles(override.media) }),
      ...(override.thread === undefined ? {} : { thread: toThreadSegments(override.thread) }),
    },
  ]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Rejects overrides for accounts the post does not target, so content is never silently dropped. */
export function assertOverridesTargetAccounts(overrides: AccountOverridesMap | undefined, accountIds: string[]): void {
  const unknown = Object.keys(overrides ?? {}).filter((accountId) => !accountIds.includes(accountId));
  if (unknown.length > 0) {
    throw new Error(
      `accountOverrides has content for accounts that aren't in accountIds: ${unknown.join(", ")}. Key overrides by the account IDs the post targets.`,
    );
  }
}
