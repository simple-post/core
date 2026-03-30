import { z } from "zod";

import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

export const validatePostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: z
    .array(z.string())
    .min(1)
    .describe("IDs of connected accounts to validate against. Use list_accounts to get available IDs."),
});

export async function validatePost(userId: string, input: z.infer<typeof validatePostSchema>) {
  const result = await validatePostForAccounts({
    userId,
    message: input.message,
    media: [],
    accountIds: input.accountIds,
  });

  return {
    isValid: result.summary.isValid,
    platforms: result.platforms,
    accounts: result.results.map((r) => ({
      accountId: r.accountId,
      platform: r.platform,
      isValid: r.isValid,
      errors: r.errors.map((e) => ({ message: e.message, field: e.field })),
      warnings: r.warnings.map((w) => ({ message: w.message, field: w.field })),
      rules: r.rules,
    })),
  };
}
