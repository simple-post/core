import { z } from "zod";

import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

import { mcpAccountSchema } from "./accounts";
import { mcpMediaItemSchema, toMediaFiles } from "./media-schema";

export const validatePostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: z
    .array(z.string())
    .min(1)
    .describe("IDs of connected accounts to validate against. Use list_accounts to get available IDs."),
  media: z
    .array(mcpMediaItemSchema)
    .optional()
    .describe(
      "Optional images/videos to validate alongside the text. Each item needs a public URL (user-provided or returned by upload_media).",
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
  const mediaFiles = toMediaFiles(input.media);
  const result = await validatePostForAccounts({
    userId,
    message: input.message,
    media: mediaFiles,
    accountIds: input.accountIds,
  });

  return {
    kind: "validation" as const,
    isValid: result.summary.isValid,
    platforms: result.platforms,
    accounts: result.results.map((r) => ({
      accountId: r.accountId,
      platform: r.platform,
      username: result.accounts.find((account) => account.id === r.accountId)?.username ?? null,
      displayName: result.accounts.find((account) => account.id === r.accountId)?.displayName ?? null,
      isValid: r.isValid,
      errors: r.errors.map((e) => ({ message: e.message, field: e.field })),
      warnings: r.warnings.map((w) => ({ message: w.message, field: w.field })),
    })),
    summary: {
      accountCount: result.results.length,
      mediaCount: mediaFiles.length,
      errorCount: result.summary.errors.length,
      warningCount: result.summary.warnings.length,
    },
  };
}
