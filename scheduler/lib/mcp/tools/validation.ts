import { AccountIdsSchema, AccountOptionsMapSchema } from "@simple-post/sdk";
import { z } from "zod";

import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

import { mcpAccountSchema } from "./accounts";
import { mcpMediaArraySchema, mcpThreadSchema, toMediaFiles, toThreadSegments } from "./media-schema";

export const validatePostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: AccountIdsSchema.describe(
    "IDs of connected accounts to validate against. Use list_accounts to get available IDs.",
  ),
  media: mcpMediaArraySchema
    .optional()
    .describe(
      "Optional images/videos to validate alongside the text. Each item needs a public URL (user-provided or returned by upload_media).",
    ),
  thread: mcpThreadSchema,
  accountOptions: AccountOptionsMapSchema.optional().describe(
    "Optional per-account platform settings keyed by account ID. Reddit accounts require subreddit and title.",
  ),
});

const validationIssueSchema = z.object({
  message: z.string(),
  field: z.string().optional(),
});

export const validationAccountSchema = mcpAccountSchema.extend({
  isValid: z.boolean(),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
});

export const validatePostOutputSchema = z.object({
  kind: z.literal("validation"),
  message: z.string().describe("The post text that was validated, echoed back so the UI can show a preview."),
  mediaCount: z.number().describe("Number of media items that were validated alongside the message."),
  isValid: z.boolean(),
  platforms: z.array(z.string()),
  accounts: z.array(validationAccountSchema),
  summary: z.object({
    accountCount: z.number(),
    mediaCount: z.number(),
    errorCount: z.number(),
    warningCount: z.number(),
  }),
});

export async function validatePost(userId: string, input: z.infer<typeof validatePostSchema>) {
  const accountIds = [...new Set(input.accountIds)];
  const mediaFiles = toMediaFiles(input.media);
  const threadSegments = toThreadSegments(input.thread);
  const result = await validatePostForAccounts({
    userId,
    message: input.message,
    media: mediaFiles,
    accountIds,
    thread: threadSegments.length > 0 ? threadSegments : undefined,
    accountOptions: input.accountOptions,
  });

  return {
    kind: "validation" as const,
    message: input.message,
    mediaCount: mediaFiles.length,
    isValid: result.summary.isValid,
    platforms: result.platforms,
    accounts: result.results.map((r) => {
      const account = result.accounts.find((a) => a.id === r.accountId);
      return {
        accountId: r.accountId,
        platform: r.platform,
        username: account?.username ?? null,
        displayName: account?.displayName ?? null,
        profilePicture: account?.profilePicture ?? null,
        isValid: r.isValid,
        errors: r.errors.map((e) => ({ message: e.message, field: e.field })),
        warnings: r.warnings.map((w) => ({ message: w.message, field: w.field })),
      };
    }),
    summary: {
      accountCount: result.results.length,
      mediaCount: mediaFiles.length,
      errorCount: result.summary.errors.length,
      warningCount: result.summary.warnings.length,
    },
  };
}
