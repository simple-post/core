import { AccountOptionsMapSchema, AccountOverridesMapSchema, MediaFileSchema, ThreadSchema } from "@simple-post/sdk";
import { z } from "zod";

import { timeZoneSchema } from "@/lib/preferences/publishing";

// Full SDK content preserves attached media and options. Publishing state is never scratch data.
export const editorContentSchema = z
  .object({
    message: z.string().max(100_000),
    accountIds: z.array(z.string().min(1)).max(50),
    media: z.array(MediaFileSchema).max(50).default([]),
    thread: ThreadSchema.default([]),
    accountOverrides: AccountOverridesMapSchema.default({}),
    accountOptions: AccountOptionsMapSchema.default({}),
    quotePostId: z.string().min(1).nullable().default(null),
    plannedSchedule: z
      .object({
        localTime: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]),
        timeZone: timeZoneSchema,
      })
      .optional(),
  })
  .strict();
export type EditorContent = z.infer<typeof editorContentSchema>;
export const editorPatchSchema = editorContentSchema.partial().strict();
export const sessionVersionSchema = z.object({
  sessionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export const sessionUpdateSchema = sessionVersionSchema.extend({ content: editorContentSchema });
export const proposalSchema = sessionVersionSchema.extend({
  patch: editorPatchSchema,
  explanation: z.string().max(2000),
});
export const sessionCommitSchema = sessionVersionSchema.extend({
  mode: z.enum(["draft", "schedule", "now"]),
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
  scheduledLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  timeZone: z.string().max(100).optional(),
  imageFit: z.enum(["crop", "blur"]).optional(),
});
