import { z } from "zod";

import { ApiError } from "@/lib/utils/errors";

import { createPostSchema } from "./posts";

const createPostFormFields = {
  accountId: z.string().min(1),
  message: z.string().min(1),
  idempotencyKey: createPostSchema.shape.idempotencyKey.unwrap(),
};

export const createPabblyPostFormSchema = z.discriminatedUnion("postingMode", [
  z.strictObject({ ...createPostFormFields, postingMode: z.literal("draft") }),
  z.strictObject({
    ...createPostFormFields,
    postingMode: z.literal("schedule"),
    scheduledFor: z.iso.datetime(),
  }),
]);

export async function readPabblyCreatePostBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new ApiError(
      "Use application/x-www-form-urlencoded for Pabbly post requests.",
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }

  const { accountId, ...post } = createPabblyPostFormSchema.parse(Object.fromEntries(await request.formData()));
  return { ...post, accountIds: [accountId] };
}
