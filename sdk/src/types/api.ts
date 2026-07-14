import { z } from "zod";

import type { Platform } from "./post";

export const MediaFileSchema = z.object({
  id: z.string(),
  url: z.url(),
  thumbnailUrl: z.url().optional(),
  type: z.enum(["image", "video"]),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative().optional(),
});

export type MediaFile = z.infer<typeof MediaFileSchema>;

export const AccountOptionsValueSchema = z
  .object({
    replyToId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    categoryId: z.string().optional(),
    playlistId: z.string().optional(),
    thumbnailUrl: z.url().optional(),
    selfDeclaredMadeForKids: z.boolean().optional(),
    publishAt: z.string().optional(),
    privacyStatus: z.enum(["public", "private", "unlisted"]).optional(),
    publishMode: z.enum(["draft", "public"]).optional(),
    privacyLevel: z
      .enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])
      .optional(),
    visibility: z.enum(["public", "friends", "private", "PUBLIC", "CONNECTIONS"]).optional(),
    allowComment: z.boolean().optional(),
    allowDuet: z.boolean().optional(),
    allowStitch: z.boolean().optional(),
    commercialContentDisclosure: z.boolean().optional(),
    discloseYourBrand: z.boolean().optional(),
    discloseBrandedContent: z.boolean().optional(),
    parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional(),
    boardId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    link: z.url().optional(),
    altText: z.string().optional(),
    published: z.boolean().optional(),
    series: z.string().nullable().optional(),
    canonicalUrl: z.string().nullable().optional(),
    organizationId: z.number().nullable().optional(),
    hubUrl: z.string().optional(),
    snapchainUrls: z.array(z.string()).optional(),
    signerTtlSeconds: z.number().int().positive().optional(),
    username: z.string().optional(),
  })
  .passthrough();

const accountOptionsValueSchema = AccountOptionsValueSchema.optional();

export const AccountOptionsMapSchema = z.record(z.string(), accountOptionsValueSchema);

export type AccountOptionsMap = Record<string, Record<string, unknown> | undefined>;

// Maximum number of additional segments after the root post. X allows 25 total
// posts in a thread, so 24 additional segments after the root.
export const MAX_THREAD_SEGMENTS = 24;

// Platforms with native thread / reply support today.
export const THREAD_CAPABLE_PLATFORMS = ["x", "bluesky", "threads", "telegram"] as const;
export type ThreadCapablePlatform = (typeof THREAD_CAPABLE_PLATFORMS)[number];

export function isThreadCapablePlatform(platform: string): platform is ThreadCapablePlatform {
  return (THREAD_CAPABLE_PLATFORMS as readonly string[]).includes(platform);
}

export const ThreadSegmentSchema = z.object({
  message: z.string().default(""),
  media: z.array(MediaFileSchema).optional(),
});

export type ThreadSegment = z.infer<typeof ThreadSegmentSchema>;

export const ThreadSchema = z.array(ThreadSegmentSchema).max(MAX_THREAD_SEGMENTS);

export const AccountContentOverrideSchema = z.object({
  message: z.string().optional(),
  media: z.array(MediaFileSchema).optional(),
  thread: ThreadSchema.optional(),
});

export type AccountContentOverride = z.infer<typeof AccountContentOverrideSchema>;

export const AccountOverridesMapSchema = z.record(z.string(), AccountContentOverrideSchema);

export type AccountOverridesMap = z.infer<typeof AccountOverridesMapSchema>;

export const RepostSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  delayHours: z
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(12),
});

export type RepostSettings = z.infer<typeof RepostSettingsSchema>;

export const RepostTargetSchema = z.object({
  postId: z.string().min(1),
  uri: z.string().optional(),
  cid: z.string().optional(),
  postUrl: z.url().optional(),
});

export type RepostTarget = z.infer<typeof RepostTargetSchema>;

export const RepostTargetsMapSchema = z.record(z.string(), RepostTargetSchema);

export type RepostTargetsMap = z.infer<typeof RepostTargetsMapSchema>;

// Normalize account targets at the validation boundary so retries and callers
// cannot publish more than once to the same connected account.
export const AccountIdsSchema = z
  .array(z.string())
  .min(1, "At least one account is required")
  .overwrite((accountIds) => [...new Set(accountIds)]);

export const repostPostSchema = z
  .object({
    accountIds: AccountIdsSchema.optional(),
    target: RepostTargetSchema.optional(),
    accountTargets: RepostTargetsMapSchema.optional(),
    accountOptions: AccountOptionsMapSchema.optional(),
  })
  .refine((data) => data.target || data.accountTargets, {
    message: "Either target or accountTargets is required",
  })
  .refine((data) => data.accountTargets || (data.target && data.accountIds && data.accountIds.length > 0), {
    message: "accountIds is required when using a shared target",
  });

export type RepostPostInput = z.infer<typeof repostPostSchema>;

// Repost capability lives in the browser-safe platform-names module so client
// bundles can import it without dragging in the Node-only SDK barrel. Re-exported
// here to keep the `@simple-post/sdk` barrel surface unchanged for server callers.
export { REPOST_CAPABLE_PLATFORMS, isRepostCapablePlatform } from "../platform-names";
export type { RepostCapablePlatform } from "../platform-names";

export const createPostSchema = z.object({
  message: z.string().default(""),
  accountIds: AccountIdsSchema,
  postingMode: z.enum(["now", "schedule"]).default("schedule"),
  scheduledFor: z.iso.datetime().optional(),
  accountOptions: AccountOptionsMapSchema.optional(),
  accountOverrides: AccountOverridesMapSchema.optional(),
  repost: RepostSettingsSchema.optional(),
  media: z.array(MediaFileSchema).optional(),
  thread: ThreadSchema.optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      "Optional client-supplied key making creation idempotent: retrying a request with the same key returns the originally created post instead of creating (and publishing) a duplicate.",
    ),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const validationRequestSchema = z.object({
  message: z.string().default(""),
  media: z.array(MediaFileSchema).default([]),
  accountIds: AccountIdsSchema,
  accountOverrides: AccountOverridesMapSchema.optional(),
  thread: ThreadSchema.optional(),
});

export type ValidationRequestInput = z.infer<typeof validationRequestSchema>;

export interface ThreadSegmentResult {
  index: number;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  message?: string;
  details?: unknown;
}

export interface PostingResult {
  accountId: string;
  platform: Platform | string;
  success: boolean;
  error?: string;
  message?: string;
  postId?: string;
  postUrl?: string;
  details?: unknown;
  // Present when the post is a thread. The first entry (index 0) corresponds
  // to the root post; postId/postUrl above always reflect the root.
  threadResults?: ThreadSegmentResult[];
}

export interface PostingSummary {
  successCount: number;
  failureCount: number;
  overallSuccess: boolean;
}
