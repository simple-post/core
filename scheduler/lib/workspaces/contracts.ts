import { z } from "zod";

export const roles = ["Admin", "Editor", "Viewer"] as const;
export const platforms = ["instagram", "tiktok", "linkedin"] as const;
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(80);
const role = z.enum(roles);
const timestamp = z.iso.datetime().transform((value) => new Date(value).toISOString());
export const workspaceFields = z.object({
  name,
  icon: z.string().trim().min(1).max(12),
  description: z.string().trim().max(500),
});
export const variantSchema = z.object({
  platform: z.enum(platforms),
  caption: z.string().max(12_000),
  accountId: id.nullable(),
  destination: z
    .object({ label: z.string().max(512), platformAccountId: id })
    .nullable()
    .default(null),
  fileIds: z.array(id).max(10),
  options: z.strictObject({
    visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
    privacyLevel: z
      .enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])
      .optional(),
  }),
});
export const snapshotSchema = z.object({
  title: name,
  plannedAt: timestamp,
  variants: z
    .array(variantSchema)
    .min(1)
    .max(3)
    .refine((v) => new Set(v.map((item) => item.platform)).size === v.length, "Choose each platform once"),
});
const fields = snapshotSchema.extend({ ownerId: id.nullable(), dueAt: timestamp.nullable() });
const postRef = { postId: id, revision: z.int().positive() };
const membership = { role, approver: z.boolean() };
export const commandSchema = z.discriminatedUnion("action", [
  workspaceFields.extend({ action: z.literal("settings") }),
  z.object({
    action: z.literal("invite"),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    ...membership,
  }),
  z.object({ action: z.literal("revoke"), inviteId: id }),
  z.object({ action: z.literal("removeFile"), fileId: id }),
  z.object({ action: z.literal("member"), userId: id, ...membership }),
  z.object({ action: z.literal("remove"), userId: id }),
  z.object({ action: z.literal("state"), stateId: id.optional(), name, position: z.int().min(1).max(999) }),
  z.object({ action: z.literal("deleteState"), stateId: id }),
  fields.extend({ action: z.literal("createPost") }),
  fields.extend({ action: z.literal("edit"), ...postRef }),
  z.object({ action: z.literal("move"), ...postRef, stateId: id }),
  z.object({ action: z.literal("submit"), ...postRef }),
  z.object({
    action: z.literal("decide"),
    postId: id,
    reviewId: id,
    outcome: z.enum(["approved", "changes"]),
    body: z.string().trim().max(4000),
  }),
  z.object({ action: z.literal("comment"), postId: id, body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("release"), postId: id, reviewId: id }),
]);
export type WorkspaceCommand = z.infer<typeof commandSchema>;
export type Variant = z.infer<typeof variantSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Actor = { id: string; name: string; email: string; emailVerified: boolean };
export const maxFileSize = 8 * 1024 * 1024;
