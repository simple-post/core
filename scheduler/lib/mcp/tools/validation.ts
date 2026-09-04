import { AccountIdsSchema, AccountOptionsMapSchema } from "@simple-post/sdk";
import { z } from "zod";

import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

import { resolveMcpAccountOptions } from "./account-options";
import { mcpAccountIdentitySchema } from "./accounts";
import { mcpMediaArraySchema, mcpThreadSchema, toMediaFiles, toThreadSegments } from "./media-schema";

export const validatePostSchema = z.object({
  message: z.string().describe("The post text content"),
  accountIds: AccountIdsSchema.describe(
    "IDs of connected accounts to validate against. Use list_accounts to get available IDs.",
  ),
  accountOptions: AccountOptionsMapSchema.optional().describe(
    'Platform settings keyed by account ID, not platform name. TikTok defaults to PUBLIC_TO_EVERYONE when privacy is omitted. Pass privacyLevel to override, e.g. {"ACCOUNT_ID":{"privacyLevel":"SELF_ONLY"}} for only me. Explicit privacyLevel or legacy visibility choices are preserved. Use get_tiktok_creator_info to inspect allowed choices. For TikTok photo carousels pass 1–35 image URLs, autoAddMusic:true for recommended music on Direct Post, photoCoverIndex (zero-based, default 0), title (90 characters), and description (4000 characters, defaults to message). Set publishMode:"draft" to upload to the TikTok inbox and manually add music/edit/publish; omit autoAddMusic or set false. Use postingMode:"now" (or "schedule") for the upload to run; postingMode:"draft" only saves a SimplePost draft. Also supports allowComment, allowDuet, allowStitch and commercial disclosure choices.',
  ),
  media: mcpMediaArraySchema
    .optional()
    .describe(
      "Optional images/videos to validate alongside the text. Each item needs a public URL (user-provided or returned by upload_media).",
    ),
  thread: mcpThreadSchema,
});

const validationIssueSchema = z.object({
  message: z.string(),
  field: z.string().optional(),
});

export const validationAccountSchema = mcpAccountIdentitySchema.extend({
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

export async function validatePost(
  userId: string,
  input: z.infer<typeof validatePostSchema>,
): Promise<z.infer<typeof validatePostOutputSchema>> {
  const accountIds = [...new Set(input.accountIds)];
  const mediaFiles = toMediaFiles(input.media);
  const threadSegments = toThreadSegments(input.thread);
  const result = await validatePostForAccounts({
    userId,
    message: input.message,
    media: mediaFiles,
    accountIds,
    accountOptions: await resolveMcpAccountOptions(userId, accountIds, input.accountOptions),
    thread: threadSegments.length > 0 ? threadSegments : undefined,
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
