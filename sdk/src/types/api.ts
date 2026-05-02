import { z } from "zod/v4";

import type { Platform } from "./post";

export const MediaFileSchema = z.object({
  id: z.string(),
  url: z.url(),
  thumbnailUrl: z.url().optional(),
  type: z.enum(["image", "video"]),
  filename: z.string(),
  size: z.number().int().nonnegative(),
});

export type MediaFile = z.infer<typeof MediaFileSchema>;

const accountOptionsValueSchema = z.record(z.string(), z.unknown()).optional();

export type AccountOptionsMap = Record<string, Record<string, unknown> | undefined>;

export const AccountContentOverrideSchema = z.object({
  message: z.string().optional(),
  media: z.array(MediaFileSchema).optional(),
});

export type AccountContentOverride = z.infer<typeof AccountContentOverrideSchema>;

export const AccountOverridesMapSchema = z.record(z.string(), AccountContentOverrideSchema);

export type AccountOverridesMap = z.infer<typeof AccountOverridesMapSchema>;

export const createPostSchema = z.object({
  message: z.string().default(""),
  accountIds: z.array(z.string()).min(1, "At least one account is required"),
  postingMode: z.enum(["now", "schedule"]).default("schedule"),
  scheduledFor: z.iso.datetime().optional(),
  accountOptions: z.record(z.string(), accountOptionsValueSchema).optional(),
  accountOverrides: AccountOverridesMapSchema.optional(),
  media: z.array(MediaFileSchema).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const validationRequestSchema = z.object({
  message: z.string().default(""),
  media: z.array(MediaFileSchema).default([]),
  accountIds: z.array(z.string()).min(1, "accountIds are required for validation"),
  accountOverrides: AccountOverridesMapSchema.optional(),
});

export type ValidationRequestInput = z.infer<typeof validationRequestSchema>;

export interface PostingResult {
  accountId: string;
  platform: Platform | string;
  success: boolean;
  error?: string;
  message?: string;
  postId?: string;
  postUrl?: string;
  details?: unknown;
}

export interface PostingSummary {
  successCount: number;
  failureCount: number;
  overallSuccess: boolean;
}
