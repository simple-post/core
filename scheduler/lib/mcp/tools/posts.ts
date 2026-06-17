import { Prisma } from "@prisma/client";
import { z } from "zod";

import { PostsModel } from "@/lib/db";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { checkRateLimits } from "@/lib/utils/rate-limit";
import {
  checkAndDeductXCredits,
  refundXCreditsForAccountIds,
  refundXCreditsForDiscardedPost,
  refundXCreditsForFailedResults,
} from "@/lib/utils/x-credits";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { dispatchPostWebhooks } from "@/lib/webhooks";
import type { AccountResultsMap, MediaFile, SocialPost, ThreadSegment } from "@/types";

import { listAccounts, mcpAccountSchema } from "./accounts";
import {
  mcpMediaArraySchema,
  mcpMediaItemSchema,
  mcpThreadArraySchema,
  mcpThreadSchema,
  mcpThreadSegmentSchema,
  toMediaFiles,
  toThreadSegments,
} from "./media-schema";
import { validatePost, validatePostOutputSchema } from "./validation";

export const createPostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: z
    .array(z.string())
    .min(1)
    .describe("IDs of connected accounts to post to. Use list_accounts to get available IDs."),
  media: mcpMediaArraySchema
    .optional()
    .describe(
      "Optional images/videos to attach. Each item must have a public URL, either one the user provided or one returned by upload_media. Some platforms, such as Instagram, require media; YouTube requires a video.",
    ),
  thread: mcpThreadSchema,
  postingMode: z
    .enum(["now", "schedule", "draft"])
    .default("now")
    .describe("'now' to post immediately, 'schedule' to schedule for later, or 'draft' to save without publishing"),
  scheduledFor: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "Required when postingMode is 'schedule'; ignored for 'draft'. Use a full ISO 8601 datetime with timezone: YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss+HH:mm (examples: 2026-05-01T14:30:00Z, 2026-05-01T16:30:00+02:00). Never send date-only or local time without timezone.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      "Optional unique key making creation idempotent. If a post was already created with this key, the original post is returned instead of creating and publishing a duplicate. Recommended when retrying after a timeout.",
    ),
});

export const previewPostSchema = createPostSchema;

const mcpPostSchema = z.object({
  id: z.string(),
  message: z.string(),
  accountIds: z.array(z.string()),
  scheduledFor: z.string().nullable(),
  status: z.string(),
  publishedAt: z.string().nullable(),
});

const threadSegmentResultSchema = z.object({
  index: z.number(),
  success: z.boolean(),
  postId: z.string().optional(),
  postUrl: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const postingResultSchema = z.object({
  accountId: z.string(),
  platform: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  message: z.string().optional(),
  postUrl: z.string().optional(),
  postId: z.string().optional(),
  threadResults: z.array(threadSegmentResultSchema).optional(),
});

export const previewPostOutputSchema = z.object({
  kind: z.literal("preview"),
  message: z.string(),
  postingMode: z.enum(["now", "schedule", "draft"]),
  scheduledFor: z.string().nullable(),
  mediaCount: z.number(),
  accounts: z.array(mcpAccountSchema),
  validation: validatePostOutputSchema,
  summary: z.object({
    accountCount: z.number(),
    mediaCount: z.number(),
    threadSegmentCount: z.number(),
    errorCount: z.number(),
    warningCount: z.number(),
  }),
});

export const createPostOutputSchema = z.object({
  kind: z.literal("post"),
  message: z.string(),
  postingMode: z.enum(["now", "schedule", "draft"]),
  mediaCount: z.number(),
  post: mcpPostSchema,
  postingResults: z.array(postingResultSchema),
  summary: z.object({
    accountCount: z.number(),
    mediaCount: z.number(),
    threadSegmentCount: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
    scheduledCount: z.number(),
    draftCount: z.number(),
    overallSuccess: z.boolean(),
    replayed: z
      .boolean()
      .optional()
      .describe("True when this response returns a previously created post matched by idempotencyKey."),
  }),
});

export const inspectPostsSchema = z.object({
  status: z
    .enum(["drafts", "scheduled", "posted", "failed", "all"])
    .default("all")
    .describe(
      "Which post status to inspect. Use 'all' to inspect drafts, scheduled, already posted, and failed posts.",
    ),
  postId: z
    .string()
    .optional()
    .describe("Optional exact SimplePost post ID to inspect. When provided, status, page, and limit are ignored."),
  page: z.number().int().min(1).default(1).describe("Page number for a single status listing."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum posts to return. For status='all', this is the maximum returned per status."),
});

export const updateScheduledPostSchema = z.object({
  postId: z
    .string()
    .describe("ID of the draft or future scheduled SimplePost post to edit. Use inspect_posts to find it."),
  postingMode: z
    .enum(["draft", "schedule"])
    .optional()
    .describe("Set to 'draft' to save as a draft or 'schedule' to schedule for later. Omit to keep the current state."),
  message: z.string().optional().describe("Replacement root post text. Omit to keep the current text."),
  accountIds: z
    .array(z.string())
    .min(1)
    .optional()
    .describe("Replacement connected account IDs. Use list_accounts to get valid IDs. Omit to keep current targets."),
  media: mcpMediaArraySchema
    .nullable()
    .optional()
    .describe(
      'Replacement root media array. Each item is {"type":"image"|"video","url":"https://...","thumbnailUrl"?}. Omit to keep current root media; pass null or [] to clear root media.',
    ),
  thread: mcpThreadArraySchema
    .nullable()
    .optional()
    .describe(
      'Replacement follow-up text-only thread segments. Each segment is {"message":"..."}. Omit to keep current thread; pass null or [] to clear all follow-up segments.',
    ),
  scheduledFor: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "Replacement future scheduled time as a full ISO 8601 datetime with timezone. Omit to keep the current scheduled time. Providing this for a draft moves it to scheduled.",
    ),
});

export const discardScheduledPostSchema = z.object({
  postId: z
    .string()
    .describe("ID of the draft or future scheduled SimplePost post to discard. Use inspect_posts to find it."),
});

const storedMediaSchema = mcpMediaItemSchema.extend({
  id: z.string().optional(),
  filename: z.string().optional(),
  size: z.number().optional(),
});

const storedThreadSegmentSchema = mcpThreadSegmentSchema.extend({
  media: z.array(storedMediaSchema).optional(),
});

const managedPostStatusSchema = z.enum(["draft", "scheduled", "pending", "posted", "failed"]);

const managedPostSchema = z.object({
  id: z.string(),
  message: z.string(),
  accountIds: z.array(z.string()),
  accounts: z.array(mcpAccountSchema),
  media: z.array(storedMediaSchema),
  thread: z.array(storedThreadSegmentSchema),
  scheduledFor: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  status: managedPostStatusSchema,
  errorMessage: z.string().nullable(),
  mediaCount: z.number(),
  threadSegmentCount: z.number(),
});

const paginationSchema = z
  .object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .nullable();

export const inspectPostsOutputSchema = z.object({
  kind: z.literal("posts"),
  status: z.enum(["drafts", "scheduled", "posted", "failed", "all", "single"]),
  posts: z.array(managedPostSchema),
  pagination: paginationSchema,
  summary: z.object({
    totalReturned: z.number(),
    draftCount: z.number(),
    scheduledCount: z.number(),
    postedCount: z.number(),
    failedCount: z.number(),
  }),
});

export const updateScheduledPostOutputSchema = z.object({
  kind: z.literal("scheduled_post_update"),
  post: managedPostSchema,
  validation: validatePostOutputSchema,
  summary: z.object({
    updated: z.boolean(),
    messageChanged: z.boolean(),
    accountsChanged: z.boolean(),
    mediaChanged: z.boolean(),
    threadChanged: z.boolean(),
    statusChanged: z.boolean(),
    scheduledForChanged: z.boolean(),
  }),
});

export const discardScheduledPostOutputSchema = z.object({
  kind: z.literal("scheduled_post_discard"),
  post: managedPostSchema,
  summary: z.object({
    discarded: z.boolean(),
    deletedMediaCount: z.number(),
  }),
});

function resolveScheduledFor(input: z.infer<typeof createPostSchema>): Date | null {
  const postingMode = input.postingMode ?? "now";
  if (postingMode === "draft") {
    return null;
  }

  if (postingMode === "now") {
    return new Date();
  }

  if (!input.scheduledFor) {
    throw new Error(
      "To schedule this post, please provide the date and time it should be published (the scheduledFor field).",
    );
  }

  const scheduledFor = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new TypeError(
      "The scheduled time isn't a valid date. Use an ISO 8601 datetime with a timezone, like 2026-05-01T14:30:00Z.",
    );
  }
  if (scheduledFor <= new Date()) {
    throw new Error("That scheduled time has already passed — please pick a time in the future.");
  }

  return scheduledFor;
}

function missingAccountsError(requestedIds: string[], foundIds: string[]): Error {
  const missing = requestedIds.filter((id) => !foundIds.includes(id));
  const list = missing.length > 0 ? missing.join(", ") : requestedIds.join(", ");
  return new Error(
    `These accounts aren't connected to SimplePost: ${list}. Call list_accounts to see the available accounts.`,
  );
}

const POST_NOT_FOUND_MESSAGE =
  "Couldn't find that post — it may have been deleted. Use inspect_posts to list your current posts.";

function mapPost(post: {
  id: string;
  message: string;
  accountIds: string[];
  scheduledFor: Date | null;
  status: string;
  publishedAt?: Date | null;
}) {
  return {
    id: post.id,
    message: post.message,
    accountIds: post.accountIds,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}

type ManagedPostStatus = z.infer<typeof managedPostStatusSchema>;
type ManagedPost = z.infer<typeof managedPostSchema>;

function mapManagedStatus(status: SocialPost["status"]): ManagedPostStatus {
  if (status === "published") return "posted";
  return status;
}

function mapStoredMedia(media: MediaFile): z.infer<typeof storedMediaSchema> {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    filename: media.filename,
    size: media.size,
  };
}

function mapStoredThread(thread: ThreadSegment[] | undefined): z.infer<typeof storedThreadSegmentSchema>[] {
  return (thread ?? []).map((segment) => ({
    message: segment.message,
    media: segment.media?.map(mapStoredMedia),
  }));
}

async function getAccountMap(userId: string) {
  const result = await listAccounts(userId);
  return new Map(result.accounts.map((account) => [account.accountId, account]));
}

function mapManagedPost(post: SocialPost, accountMap: Awaited<ReturnType<typeof getAccountMap>>): ManagedPost {
  const thread = mapStoredThread(post.thread);
  return {
    id: post.id,
    message: post.message,
    accountIds: post.accountIds,
    accounts: post.accountIds.map((accountId) => accountMap.get(accountId)).filter((account) => account !== undefined),
    media: post.media.map((media) => mapStoredMedia(media)),
    thread,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    publishedAt: post.publishedAt?.toISOString() ?? null,
    status: mapManagedStatus(post.status),
    errorMessage: post.errorMessage ?? null,
    mediaCount: post.media.length,
    threadSegmentCount: thread.length,
  };
}

function countStatuses(posts: ManagedPost[]) {
  return {
    totalReturned: posts.length,
    draftCount: posts.filter((post) => post.status === "draft").length,
    scheduledCount: posts.filter((post) => post.status === "scheduled").length,
    postedCount: posts.filter((post) => post.status === "posted").length,
    failedCount: posts.filter((post) => post.status === "failed").length,
  };
}

async function getPostsForStatus(
  repository: PostsModel,
  status: "drafts" | "scheduled" | "posted" | "failed",
  options: { page: number; limit: number },
) {
  if (status === "drafts") return await repository.getDraftPosts(options);
  if (status === "scheduled") return await repository.getScheduledPosts(options);
  if (status === "posted") return await repository.getPublishedPosts(options);
  return await repository.getFailedPosts(options);
}

function assertEditableManagedPost(post: SocialPost): void {
  if (post.status === "draft") {
    return;
  }
  if (post.status !== "scheduled") {
    throw new Error(
      `This post has already been ${post.status === "failed" ? "attempted" : "published"}, so it can no longer be edited or deleted here. Only drafts and upcoming scheduled posts can be changed.`,
    );
  }
  if (!post.scheduledFor || post.scheduledFor <= new Date()) {
    throw new Error(
      "This post is due to be published right now or already went out, so it can no longer be edited or deleted.",
    );
  }
}

function resolveUpdatedScheduledFor(value: string | undefined, currentValue: Date | null): Date {
  if (!value) {
    if (!currentValue) {
      throw new Error("To schedule this draft, please provide the date and time it should be published.");
    }
    return currentValue;
  }

  const scheduledFor = new Date(value);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new TypeError(
      "The scheduled time isn't a valid date. Use an ISO 8601 datetime with a timezone, like 2026-05-01T14:30:00Z.",
    );
  }
  if (scheduledFor <= new Date()) {
    throw new Error("That scheduled time has already passed — please pick a time in the future.");
  }

  return scheduledFor;
}

function collectMediaForCleanup(post: Pick<SocialPost, "media" | "thread">): MediaFile[] {
  return [...post.media, ...(post.thread ?? []).flatMap((segment) => segment.media ?? [])];
}

function getRemovedMedia(oldPost: SocialPost, newMedia: MediaFile[], newThread: ThreadSegment[] | undefined) {
  const keptUrls = new Set([
    ...newMedia.map((media) => media.url),
    ...(newThread ?? []).flatMap((segment) => (segment.media ?? []).map((media) => media.url)),
  ]);
  return collectMediaForCleanup(oldPost).filter((media) => !keptUrls.has(media.url));
}

export async function previewPost(userId: string, input: z.infer<typeof previewPostSchema>) {
  const postingMode = input.postingMode ?? "now";
  const scheduledFor = postingMode === "schedule" ? resolveScheduledFor(input) : null;
  const mediaCount = input.media?.length ?? 0;
  const threadSegmentCount = input.thread?.length ?? 0;
  const validation = await validatePost(userId, {
    message: input.message,
    accountIds: input.accountIds,
    media: input.media,
    thread: input.thread,
  });

  if (validation.accounts.length !== input.accountIds.length) {
    throw missingAccountsError(
      input.accountIds,
      validation.accounts.map((account) => account.accountId),
    );
  }

  return {
    kind: "preview" as const,
    message: input.message,
    postingMode,
    scheduledFor: scheduledFor?.toISOString() ?? null,
    mediaCount,
    accounts: validation.accounts.map((account) => ({
      accountId: account.accountId,
      platform: account.platform,
      username: account.username,
      displayName: account.displayName,
      profilePicture: account.profilePicture,
    })),
    validation,
    summary: {
      accountCount: validation.summary.accountCount,
      mediaCount,
      threadSegmentCount,
      errorCount: validation.summary.errorCount,
      warningCount: validation.summary.warningCount,
    },
  };
}

export async function inspectPosts(userId: string, input: z.infer<typeof inspectPostsSchema>) {
  const repository = new PostsModel(userId);
  const accountMap = await getAccountMap(userId);
  const page = input.page ?? 1;
  const limit = input.limit ?? 10;

  if (input.postId) {
    const post = await repository.getPostById(input.postId);
    if (!post) {
      throw new Error(POST_NOT_FOUND_MESSAGE);
    }

    const posts = [mapManagedPost(post, accountMap)];
    return {
      kind: "posts" as const,
      status: "single" as const,
      posts,
      pagination: null,
      summary: countStatuses(posts),
    };
  }

  const status = input.status ?? "all";
  if (status !== "all") {
    const result = await getPostsForStatus(repository, status, { page, limit });
    const posts = result.data.map((post) => mapManagedPost(post, accountMap));

    return {
      kind: "posts" as const,
      status,
      posts,
      pagination: result.pagination,
      summary: countStatuses(posts),
    };
  }

  const [drafts, scheduled, posted, failed] = await Promise.all([
    getPostsForStatus(repository, "drafts", { page: 1, limit }),
    getPostsForStatus(repository, "scheduled", { page: 1, limit }),
    getPostsForStatus(repository, "posted", { page: 1, limit }),
    getPostsForStatus(repository, "failed", { page: 1, limit }),
  ]);
  const posts = [...drafts.data, ...scheduled.data, ...posted.data, ...failed.data].map((post) =>
    mapManagedPost(post, accountMap),
  );

  return {
    kind: "posts" as const,
    status: "all" as const,
    posts,
    pagination: null,
    summary: countStatuses(posts),
  };
}

export async function updateScheduledPost(userId: string, input: z.infer<typeof updateScheduledPostSchema>) {
  const hasChanges =
    input.message !== undefined ||
    input.accountIds !== undefined ||
    input.media !== undefined ||
    input.thread !== undefined ||
    input.postingMode !== undefined ||
    input.scheduledFor !== undefined;

  if (!hasChanges) {
    throw new Error(
      "Nothing to update — please specify what should change: the text, accounts, media, thread, or scheduled time.",
    );
  }

  const repository = new PostsModel(userId);
  const currentPost = await repository.getPostById(input.postId);
  if (!currentPost) {
    throw new Error(POST_NOT_FOUND_MESSAGE);
  }
  assertEditableManagedPost(currentPost);

  const message = input.message ?? currentPost.message;
  const accountIds = input.accountIds ?? currentPost.accountIds;
  const media = input.media === undefined ? currentPost.media : input.media === null ? [] : toMediaFiles(input.media);
  const thread =
    input.thread === undefined ? currentPost.thread : input.thread === null ? [] : toThreadSegments(input.thread);
  const threadForValidation = thread && thread.length > 0 ? thread : undefined;
  const currentPostingMode = currentPost.status === "draft" ? "draft" : "schedule";
  const targetPostingMode = input.postingMode ?? (input.scheduledFor === undefined ? currentPostingMode : "schedule");
  const scheduledFor =
    targetPostingMode === "schedule" ? resolveUpdatedScheduledFor(input.scheduledFor, currentPost.scheduledFor) : null;

  const validation = await validatePost(userId, {
    message,
    accountIds,
    media,
    thread: threadForValidation,
  });

  if (validation.accounts.length !== accountIds.length) {
    throw missingAccountsError(
      accountIds,
      validation.accounts.map((account) => account.accountId),
    );
  }

  if (targetPostingMode === "schedule" && !validation.isValid) {
    const errorMessages = validation.accounts
      .flatMap((account) => account.errors.map((error) => error.message))
      .join("; ");
    throw new Error(`Couldn't save these changes because the scheduled post would be invalid: ${errorMessages}`);
  }

  // Credit/rate-limit parity with the REST API: scheduling a draft (or
  // adding accounts to a scheduled post) deducts X credits; moving a
  // scheduled post back to draft returns them.
  if (targetPostingMode === "schedule") {
    const chargeableAccountIds =
      currentPost.status === "scheduled"
        ? accountIds.filter((accountId) => !currentPost.accountIds.includes(accountId))
        : accountIds;
    if (chargeableAccountIds.length > 0) {
      await checkRateLimits(userId, chargeableAccountIds);
      await checkAndDeductXCredits(userId, chargeableAccountIds);
    }
  } else if (currentPost.status === "scheduled") {
    await refundXCreditsForDiscardedPost(userId, currentPost);
  }

  const updates: Partial<SocialPost> = {};
  if (input.message !== undefined) updates.message = message;
  if (input.accountIds !== undefined) updates.accountIds = accountIds;
  if (input.media !== undefined) updates.media = media;
  if (input.thread !== undefined) updates.thread = thread ?? [];
  if (targetPostingMode !== currentPostingMode)
    updates.status = targetPostingMode === "schedule" ? "scheduled" : "draft";
  if (input.scheduledFor !== undefined || targetPostingMode !== currentPostingMode) updates.scheduledFor = scheduledFor;

  const updatedPost = await repository.updatePost(input.postId, updates);

  if (input.media !== undefined || input.thread !== undefined) {
    const removedMedia = getRemovedMedia(currentPost, media, threadForValidation);
    if (removedMedia.length > 0) {
      await deleteMediaFiles(removedMedia);
    }
  }

  const accountMap = await getAccountMap(userId);
  return {
    kind: "scheduled_post_update" as const,
    post: mapManagedPost(updatedPost, accountMap),
    validation,
    summary: {
      updated: true,
      messageChanged: input.message !== undefined,
      accountsChanged: input.accountIds !== undefined,
      mediaChanged: input.media !== undefined,
      threadChanged: input.thread !== undefined,
      statusChanged: targetPostingMode !== currentPostingMode,
      scheduledForChanged: input.scheduledFor !== undefined || targetPostingMode !== currentPostingMode,
    },
  };
}

export async function discardScheduledPost(userId: string, input: z.infer<typeof discardScheduledPostSchema>) {
  const repository = new PostsModel(userId);
  const post = await repository.getPostById(input.postId);
  if (!post) {
    throw new Error(POST_NOT_FOUND_MESSAGE);
  }
  assertEditableManagedPost(post);

  const accountMap = await getAccountMap(userId);
  const mappedPost = mapManagedPost(post, accountMap);
  const media = collectMediaForCleanup(post);

  await repository.deletePost(input.postId);
  await refundXCreditsForDiscardedPost(userId, post);
  if (media.length > 0) {
    await deleteMediaFiles(media);
  }

  return {
    kind: "scheduled_post_discard" as const,
    post: mappedPost,
    summary: {
      discarded: true,
      deletedMediaCount: media.length,
    },
  };
}

type PostToAccountsResults = Awaited<ReturnType<typeof postToAccounts>>;

function mapPostingResultsForMcp(results: PostToAccountsResults): z.infer<typeof postingResultSchema>[] {
  return results.map((r) => ({
    accountId: r.accountId,
    platform: r.platform,
    success: r.success,
    error: r.error,
    message: r.message,
    postUrl: r.postUrl,
    postId: r.postId,
    threadResults: r.threadResults?.map((s) => ({
      index: s.index,
      success: s.success,
      postId: s.postId,
      postUrl: s.postUrl,
      error: s.error,
      message: s.message,
    })),
  }));
}

function buildReplayResponse(post: SocialPost, input: z.infer<typeof createPostSchema>) {
  const accountResults = Object.values(post.accountResults ?? {});
  const successCount = accountResults.filter((result) => result.success).length;
  const failureCount = accountResults.filter((result) => !result.success).length;

  return {
    kind: "post" as const,
    message: post.message,
    postingMode: input.postingMode ?? "now",
    mediaCount: post.media.length,
    post: mapPost(post),
    postingResults: accountResults.map((result) => ({
      accountId: result.accountId,
      platform: result.platform,
      success: result.success,
      error: result.error,
      message: result.message,
      postUrl: result.postUrl,
      postId: result.postId,
    })),
    summary: {
      accountCount: post.accountIds.length,
      mediaCount: post.media.length,
      threadSegmentCount: post.thread?.length ?? 0,
      successCount,
      failureCount,
      scheduledCount: post.status === "scheduled" ? 1 : 0,
      draftCount: post.status === "draft" ? 1 : 0,
      overallSuccess: successCount > 0 && failureCount === 0,
      replayed: true,
    },
  };
}

export async function createPost(userId: string, input: z.infer<typeof createPostSchema>) {
  const repository = new PostsModel(userId);

  // Idempotent creation: a retried call with the same key returns the
  // originally created post instead of creating (and publishing) again.
  if (input.idempotencyKey) {
    const existing = await prisma.post.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    });
    if (existing) {
      const existingPost = await repository.getPostById(existing.id);
      if (existingPost) {
        return buildReplayResponse(existingPost, input);
      }
    }
  }

  const scheduledFor = resolveScheduledFor(input);
  const postingMode = input.postingMode ?? "now";
  const mediaFiles = toMediaFiles(input.media);
  const threadSegments = toThreadSegments(input.thread);
  const threadForPersistence = threadSegments.length > 0 ? threadSegments : undefined;
  const threadSegmentCount = threadSegments.length;

  // Validate content
  const validation = await validatePostForAccounts({
    userId,
    message: input.message,
    media: mediaFiles,
    accountIds: input.accountIds,
    thread: threadForPersistence,
  });

  if (validation.accounts.length !== input.accountIds.length) {
    throw missingAccountsError(
      input.accountIds,
      validation.accounts.map((account) => account.id),
    );
  }

  if (postingMode !== "draft" && !validation.summary.isValid) {
    const errorMessages = validation.summary.errors.map((e) => e.message).join("; ");
    throw new Error(
      `The post can't be ${postingMode === "schedule" ? "scheduled" : "published"} because it failed validation: ${errorMessages}`,
    );
  }

  // Same pre-flight checks as the REST API: MCP clients must not bypass
  // rate limits or X posting credits.
  if (postingMode !== "draft") {
    await checkRateLimits(userId, input.accountIds);
    await checkAndDeductXCredits(userId, input.accountIds);
  }

  // Create the post record
  let post: SocialPost;
  try {
    post = await repository.createPost(
      {
        message: input.message,
        accountIds: input.accountIds,
        media: mediaFiles,
        scheduledFor,
        status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
        thread: threadForPersistence,
        idempotencyKey: input.idempotencyKey,
      },
      userId,
    );
  } catch (createError) {
    // A concurrent call with the same idempotency key won the insert: undo
    // this call's deduction and return the winner's post.
    if (
      input.idempotencyKey &&
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === "P2002"
    ) {
      if (postingMode !== "draft") {
        await refundXCreditsForAccountIds(userId, input.accountIds);
      }
      const existing = await prisma.post.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      const existingPost = existing ? await repository.getPostById(existing.id) : null;
      if (existingPost) {
        return buildReplayResponse(existingPost, input);
      }
    }
    throw createError;
  }

  // If posting now, dispatch immediately
  if (postingMode === "now") {
    try {
      const results = await postToAccounts(
        userId,
        input.message,
        mediaFiles,
        input.accountIds,
        undefined,
        undefined,
        threadForPersistence,
      );
      const summary = getPostingSummary(results);

      const threadResultsByAccount: Record<string, NonNullable<(typeof results)[0]["threadResults"]>> = {};
      for (const r of results) {
        if (r.threadResults) threadResultsByAccount[r.accountId] = r.threadResults;
      }
      const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;
      const accountResults = sanitizeForJson(toAccountResultsMap(results)) as AccountResultsMap;

      if (summary.overallSuccess) {
        await repository.updatePost(post.id, {
          status: "published",
          publishedAt: new Date(),
          threadResults: hasThreadResults ? threadResultsByAccount : undefined,
          accountResults,
        });
        await dispatchPostWebhooks(userId, "post.published", {
          id: post.id,
          status: "published",
          message: input.message,
          publishedAt: new Date().toISOString(),
          accountResults,
        });
      } else {
        await refundXCreditsForFailedResults(userId, results);
        const failedResults = results.filter((r) => !r.success);
        const errorMessage =
          failedResults.length === 1
            ? failedResults[0].message || failedResults[0].error || "Unknown error"
            : `Failed on ${failedResults.length} platform(s)`;
        const errorDetails = sanitizeForJson({
          failedPlatforms: failedResults.map((r) => ({
            accountId: r.accountId,
            platform: r.platform,
            error: r.error,
            message: r.message,
            threadResults: r.threadResults,
          })),
        }) as Record<string, unknown>;

        await repository.updatePost(post.id, {
          status: "failed",
          errorMessage,
          errorDetails,
          threadResults: hasThreadResults ? threadResultsByAccount : undefined,
          accountResults,
        });
        await dispatchPostWebhooks(userId, "post.failed", {
          id: post.id,
          status: "failed",
          message: input.message,
          errorMessage,
          accountResults,
        });
      }

      const updatedPost = await repository.getPostById(post.id);
      const sanitizedResults = mapPostingResultsForMcp(results);

      return {
        kind: "post" as const,
        message: input.message,
        postingMode,
        mediaCount: mediaFiles.length,
        post: mapPost(updatedPost ?? post),
        postingResults: sanitizedResults,
        summary: {
          accountCount: input.accountIds.length,
          mediaCount: mediaFiles.length,
          threadSegmentCount,
          successCount: summary.successCount,
          failureCount: summary.failureCount,
          scheduledCount: 0,
          draftCount: 0,
          overallSuccess: summary.overallSuccess,
        },
      };
    } catch (postingError) {
      const errorMessage = postingError instanceof Error ? postingError.message : "Unknown error during posting";
      await refundXCreditsForAccountIds(userId, input.accountIds);
      await repository.updatePost(post.id, { status: "failed", errorMessage });
      throw new Error(`Something went wrong while publishing the post: ${errorMessage}`);
    }
  }

  return {
    kind: "post" as const,
    message: input.message,
    postingMode,
    mediaCount: mediaFiles.length,
    post: mapPost(post),
    postingResults: [],
    summary: {
      accountCount: input.accountIds.length,
      mediaCount: mediaFiles.length,
      threadSegmentCount,
      successCount: 0,
      failureCount: 0,
      scheduledCount: postingMode === "schedule" ? input.accountIds.length : 0,
      draftCount: postingMode === "draft" ? input.accountIds.length : 0,
      overallSuccess: true,
    },
  };
}
