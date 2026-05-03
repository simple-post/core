import { AccountOverridesMapSchema, MediaFileSchema, ThreadSchema } from "@simple-post/sdk";
import { z } from "zod/v4";

// Schemas shared with the @simple-post/server HTTP API live in @simple-post/sdk.
// Scheduler-specific schemas (e.g. updatePostSchema) stay here.
export { createPostSchema, validationRequestSchema } from "@simple-post/sdk";
export type { CreatePostInput, ValidationRequestInput } from "@simple-post/sdk";

const accountOptionsValueSchema = z.record(z.string(), z.unknown()).optional();

export const updatePostSchema = z.object({
  message: z.string().default(""),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  scheduledFor: z.iso.datetime(),
  accountOptions: z.record(z.string(), accountOptionsValueSchema).optional(),
  accountOverrides: AccountOverridesMapSchema.optional(),
  media: z.array(MediaFileSchema).optional(),
  thread: ThreadSchema.optional(),
});

export type UpdatePostInput = z.infer<typeof updatePostSchema>;
