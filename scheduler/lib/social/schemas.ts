import * as z from "zod";

export const inboxPlatformSchema = z.enum([
  "bluesky",
  "facebook",
  "forem",
  "instagram",
  "linkedin",
  "pinterest",
  "telegram",
  "threads",
  "tiktok",
  "x",
  "youtube",
]);

export const inboxQuerySchema = z.object({
  platform: inboxPlatformSchema.optional(),
  platforms: z.array(inboxPlatformSchema).max(11).optional(),
  kind: z.enum(["comment", "reply", "quote"]).optional(),
  accountId: z.string().min(1).max(100).optional(),
  needsReply: z.boolean().optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const inboxRefreshSchema = z.object({
  platform: inboxPlatformSchema.optional(),
  platforms: z.array(inboxPlatformSchema).max(11).optional(),
  reset: z.boolean().optional(),
  automatic: z.boolean().optional(),
});

export const inboxItemIdSchema = z.string().min(1).max(100);

export const inboxReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{12,160}$/u),
});

export const inboxActionStatusSchema = z.enum(["pending", "sent", "failed", "uncertain"]);

export const inboxAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  name: z.string(),
  canSync: z.boolean(),
  hasMore: z.boolean(),
  permissionUrl: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  error: z.string().optional(),
  coverage: z.string().optional(),
  retryAt: z.string().optional(),
});

export const inboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["comment", "reply", "quote"]),
  platform: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  accountUsername: z.string().optional(),
  postId: z.string(),
  sourceBody: z.string(),
  sourcePreview: z
    .object({
      media: z.array(z.looseObject({ id: z.string(), url: z.string(), type: z.enum(["image", "video"]) })),
      profilePicture: z.string().nullable(),
      publishedAt: z.string().optional(),
    })
    .optional(),
  sourceUrl: z.string().optional(),
  nativeUrl: z.string().optional(),
  body: z.string(),
  createdAt: z.string(),
  author: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      username: z.string().optional(),
      avatarUrl: z.string().optional(),
    })
    .optional(),
  canReply: z.boolean(),
  canLike: z.boolean(),
  liked: z.boolean(),
  likeStatus: z.string().optional(),
  likeError: z.string().optional(),
  reply: z
    .object({
      status: z.string(),
      body: z.string(),
      nativeReplyUrl: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
});

export const inboxPageSchema = z.object({
  items: z.array(inboxItemSchema),
  accounts: z.array(inboxAccountSchema),
  nextCursor: z.string().optional(),
});

export const inboxRefreshResultSchema = z.object({
  accounts: z.array(
    z.object({
      accountId: z.string(),
      platform: z.string(),
      processed: z.number(),
      hasMore: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  hasMore: z.boolean(),
});

export const inboxReplyReceiptSchema = z.object({
  replyId: z.string(),
  status: inboxActionStatusSchema,
  nativeReplyUrl: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const inboxLikeReceiptSchema = z.object({
  liked: z.boolean(),
  status: inboxActionStatusSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
