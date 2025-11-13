import { z } from "zod";

export const createPostSchema = z.object({
  message: z.string().min(1, "Message is required"),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  postingMode: z.enum(["now", "schedule"]).default("schedule"),
  scheduledFor: z.string().datetime().optional(),
  accountOptions: z.record(z.any()).optional(),
});

export const updatePostSchema = z.object({
  message: z.string().min(1, "Message is required"),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  scheduledFor: z.string().datetime(),
  accountOptions: z.record(z.any()).optional(),
  keepMediaIds: z.array(z.string()).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

