import {
  ImageFitSchema,
  AccountOptionsMapSchema,
  AccountOverridesMapSchema,
  AccountIdsSchema,
  MediaFileSchema,
  RepostSettingsSchema,
  ThreadSchema,
  createPostSchema as sdkCreatePostSchema,
} from "@simple-post/sdk";
import { z } from "zod";

// Schemas shared with the @simple-post/server HTTP API live in @simple-post/sdk.
// Scheduler-specific schemas (e.g. updatePostSchema) stay here.
export { validationRequestSchema } from "@simple-post/sdk";
export type { ValidationRequestInput } from "@simple-post/sdk";

export const postingModeSchema = z.enum(["now", "schedule", "draft"]);

export const createPostSchema = sdkCreatePostSchema.extend({
  postingMode: postingModeSchema.default("schedule"),
  scheduledFor: z.iso.datetime().optional(),
  quotePostId: z.string().min(1).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

const createPostFormFields = {
  accountId: z.string().min(1),
  message: z.string().min(1),
  idempotencyKey: createPostSchema.shape.idempotencyKey.unwrap(),
};

export const createPostFormSchema = z.discriminatedUnion("postingMode", [
  z.strictObject({ ...createPostFormFields, postingMode: z.literal("draft") }),
  z.strictObject({
    ...createPostFormFields,
    postingMode: z.literal("schedule"),
    scheduledFor: z.iso.datetime(),
  }),
]);

export async function readCreatePostBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return request.json();

  const { accountId, ...post } = createPostFormSchema.parse(Object.fromEntries(await request.formData()));
  return { ...post, accountIds: [accountId] };
}

export const updatePostSchema = z.object({
  expectedUpdatedAt: z.iso.datetime().optional(),
  imageFit: ImageFitSchema.optional(),
  message: z.string().default(""),
  accountIds: AccountIdsSchema,
  postingMode: postingModeSchema.optional(),
  scheduledFor: z.iso.datetime().optional(),
  accountOptions: AccountOptionsMapSchema.optional(),
  accountOverrides: AccountOverridesMapSchema.optional(),
  repost: RepostSettingsSchema.optional(),
  media: z.array(MediaFileSchema).optional(),
  thread: ThreadSchema.optional(),
  quotePostId: z.string().min(1).nullable().optional(),
});

export type UpdatePostInput = z.infer<typeof updatePostSchema>;
