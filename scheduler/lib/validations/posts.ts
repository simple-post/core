import {
  AccountOverridesMapSchema,
  MediaFileSchema,
  ThreadSchema,
  createPostSchema as sdkCreatePostSchema,
} from "@simple-post/sdk";
import { z } from "zod/v4";

// Schemas shared with the @simple-post/server HTTP API live in @simple-post/sdk.
// Scheduler-specific schemas (e.g. updatePostSchema) stay here.
export { validationRequestSchema } from "@simple-post/sdk";
export type { ValidationRequestInput } from "@simple-post/sdk";

const accountOptionsValueSchema = z.record(z.string(), z.unknown()).optional();

export const postingModeSchema = z.enum(["now", "schedule", "draft"]);

export const createPostSchema = sdkCreatePostSchema.extend({
  postingMode: postingModeSchema.default("schedule"),
  scheduledFor: z.iso.datetime().optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  message: z.string().default(""),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  postingMode: postingModeSchema.optional(),
  scheduledFor: z.iso.datetime().optional(),
  accountOptions: z.record(z.string(), accountOptionsValueSchema).optional(),
  accountOverrides: AccountOverridesMapSchema.optional(),
  media: z.array(MediaFileSchema).optional(),
  thread: ThreadSchema.optional(),
});

export type UpdatePostInput = z.infer<typeof updatePostSchema>;
