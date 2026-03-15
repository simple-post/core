import { z } from "zod";

const mediaFileSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  type: z.enum(["image", "video"]),
  filename: z.string(),
  size: z.number().int().nonnegative(),
});

const accountOptionsValueSchema = z.record(z.unknown()).optional();

const accountOverrideSchema = z.object({
  message: z.string().optional(),
  media: z.array(mediaFileSchema).optional(),
});

export const createPostSchema = z.object({
  message: z.string().default(""),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  postingMode: z.enum(["now", "schedule"]).default("schedule"),
  scheduledFor: z.string().datetime().optional(),
  accountOptions: z.record(accountOptionsValueSchema).optional(),
  accountOverrides: z.record(accountOverrideSchema).optional(),
  media: z.array(mediaFileSchema).optional(),
});

export const updatePostSchema = z.object({
  message: z.string().default(""),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  scheduledFor: z.string().datetime(),
  accountOptions: z.record(accountOptionsValueSchema).optional(),
  accountOverrides: z.record(accountOverrideSchema).optional(),
  media: z.array(mediaFileSchema).optional(),
});

export const validationRequestSchema = z.object({
  message: z.string().default(""),
  media: z.array(mediaFileSchema).default([]),
  accountIds: z.array(z.string()).min(1, "accountIds are required for validation"),
  accountOverrides: z.record(accountOverrideSchema).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
