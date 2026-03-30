import { z } from "zod";

import { PostsModel } from "@/lib/db";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { sanitizeForJson } from "@/lib/utils/errors";

export const createPostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: z
    .array(z.string())
    .min(1)
    .describe("IDs of connected accounts to post to. Use list_accounts to get available IDs."),
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

export async function createPost(userId: string, input: z.infer<typeof createPostSchema>) {
  const repository = new PostsModel(userId);

  // Determine scheduled time
  let scheduledFor: Date;
  if (input.postingMode === "now") {
    scheduledFor = new Date();
  } else {
    if (!input.scheduledFor) {
      throw new Error("scheduledFor is required when postingMode is 'schedule'");
    }
    scheduledFor = new Date(input.scheduledFor);
  }

  // Validate content
  const validation = await validatePostForAccounts({
    userId,
    message: input.message,
    media: [],
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
      media: [],
      scheduledFor,
      status: input.postingMode === "now" ? "pending" : "scheduled",
    },
    userId,
  );

  // If posting now, dispatch immediately
  if (input.postingMode === "now") {
    try {
      const results = await postToAccounts(input.message, [], input.accountIds);
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
        post: updatedPost,
        postingResults: sanitizedResults,
        summary,
      };
    } catch (postingError) {
      const errorMessage = postingError instanceof Error ? postingError.message : "Unknown error during posting";
      await repository.updatePost(post.id, { status: "failed", errorMessage });
      throw new Error(`Failed to post: ${errorMessage}`);
    }
  }

  return { post };
}
