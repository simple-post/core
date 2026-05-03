import { z } from "zod";

import { PostsModel } from "@/lib/db";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { sanitizeForJson } from "@/lib/utils/errors";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

import { mcpAccountSchema } from "./accounts";
import { mcpMediaItemSchema, toMediaFiles } from "./media-schema";
import { validatePost, validatePostOutputSchema } from "./validation";

export const createPostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: z
    .array(z.string())
    .min(1)
    .describe("IDs of connected accounts to post to. Use list_accounts to get available IDs."),
  media: z
    .array(mcpMediaItemSchema)
    .optional()
    .describe(
      "Optional images/videos to attach. Each item must have a public URL, either one the user provided or one returned by upload_media. Some platforms, such as Instagram, require media; YouTube requires a video.",
    ),
  postingMode: z
    .enum(["now", "schedule"])
    .default("now")
    .describe("'now' to post immediately, 'schedule' to schedule for later"),
  scheduledFor: z
    .string()
    .datetime()
    .optional()
    .describe("ISO 8601 datetime for scheduled posts. Required when postingMode is 'schedule'."),
});

export const previewPostSchema = createPostSchema;

const mcpPostSchema = z.object({
  id: z.string(),
  message: z.string(),
  accountIds: z.array(z.string()),
  scheduledFor: z.string(),
  status: z.string(),
  publishedAt: z.string().nullable(),
});

const postingResultSchema = z.object({
  accountId: z.string(),
  platform: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  message: z.string().optional(),
  postUrl: z.string().optional(),
});

export const previewPostOutputSchema = z.object({
  kind: z.literal("preview"),
  message: z.string(),
  postingMode: z.enum(["now", "schedule"]),
  scheduledFor: z.string(),
  mediaCount: z.number(),
  accounts: z.array(mcpAccountSchema),
  validation: validatePostOutputSchema,
  summary: z.object({
    accountCount: z.number(),
    mediaCount: z.number(),
    errorCount: z.number(),
    warningCount: z.number(),
  }),
});

export const createPostOutputSchema = z.object({
  kind: z.literal("post"),
  message: z.string(),
  postingMode: z.enum(["now", "schedule"]),
  mediaCount: z.number(),
  post: mcpPostSchema,
  postingResults: z.array(postingResultSchema),
  summary: z.object({
    accountCount: z.number(),
    mediaCount: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
    scheduledCount: z.number(),
    overallSuccess: z.boolean(),
  }),
});

function resolveScheduledFor(input: z.infer<typeof createPostSchema>): Date {
  if ((input.postingMode ?? "now") === "now") {
    return new Date();
  }

  if (!input.scheduledFor) {
    throw new Error("scheduledFor is required when postingMode is 'schedule'");
  }

  const scheduledFor = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new TypeError("scheduledFor must be a valid ISO 8601 datetime");
  }
  if (scheduledFor <= new Date()) {
    throw new Error("scheduledFor must be in the future");
  }

  return scheduledFor;
}

function mapPost(post: {
  id: string;
  message: string;
  accountIds: string[];
  scheduledFor: Date;
  status: string;
  publishedAt?: Date;
}) {
  return {
    id: post.id,
    message: post.message,
    accountIds: post.accountIds,
    scheduledFor: post.scheduledFor.toISOString(),
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}

export async function previewPost(userId: string, input: z.infer<typeof previewPostSchema>) {
  const scheduledFor = resolveScheduledFor(input);
  const postingMode = input.postingMode ?? "now";
  const mediaCount = input.media?.length ?? 0;
  const validation = await validatePost(userId, {
    message: input.message,
    accountIds: input.accountIds,
    media: input.media,
  });

  if (validation.accounts.length !== input.accountIds.length) {
    throw new Error("One or more accounts were not found");
  }

  return {
    kind: "preview" as const,
    message: input.message,
    postingMode,
    scheduledFor: scheduledFor.toISOString(),
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
      errorCount: validation.summary.errorCount,
      warningCount: validation.summary.warningCount,
    },
  };
}

export async function createPost(userId: string, input: z.infer<typeof createPostSchema>) {
  const repository = new PostsModel(userId);
  const scheduledFor = resolveScheduledFor(input);
  const postingMode = input.postingMode ?? "now";
  const mediaFiles = toMediaFiles(input.media);

  // Validate content
  const validation = await validatePostForAccounts({
    userId,
    message: input.message,
    media: mediaFiles,
    accountIds: input.accountIds,
  });

  if (validation.accounts.length !== input.accountIds.length) {
    throw new Error("One or more accounts were not found");
  }

  if (!validation.summary.isValid) {
    const errorMessages = validation.summary.errors.map((e) => e.message).join("; ");
    throw new Error(`Validation failed: ${errorMessages}`);
  }

  // Create the post record
  const post = await repository.createPost(
    {
      message: input.message,
      accountIds: input.accountIds,
      media: mediaFiles,
      scheduledFor,
      status: postingMode === "now" ? "pending" : "scheduled",
    },
    userId,
  );

  // If posting now, dispatch immediately
  if (postingMode === "now") {
    try {
      const results = await postToAccounts(input.message, mediaFiles, input.accountIds);
      const summary = getPostingSummary(results);

      if (summary.overallSuccess) {
        await repository.updatePost(post.id, { status: "published", publishedAt: new Date() });
      } else {
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
          })),
        }) as Record<string, unknown>;

        await repository.updatePost(post.id, { status: "failed", errorMessage, errorDetails });
      }

      const updatedPost = await repository.getPostById(post.id);
      const sanitizedResults = results.map((r) => ({
        accountId: r.accountId,
        platform: r.platform,
        success: r.success,
        error: r.error,
        message: r.message,
        postUrl: r.postUrl,
      }));

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
          successCount: summary.successCount,
          failureCount: summary.failureCount,
          scheduledCount: 0,
          overallSuccess: summary.overallSuccess,
        },
      };
    } catch (postingError) {
      const errorMessage = postingError instanceof Error ? postingError.message : "Unknown error during posting";
      await repository.updatePost(post.id, { status: "failed", errorMessage });
      throw new Error(`Failed to post: ${errorMessage}`);
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
      successCount: 0,
      failureCount: 0,
      scheduledCount: input.accountIds.length,
      overallSuccess: true,
    },
  };
}
