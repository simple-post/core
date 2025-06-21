import { z } from "zod/v4";

export const PlatformSchema = z.enum(["x", "youtube", "facebook", "instagram", "tiktok", "linkedin", "pinterest"]);

export const ImageSchema = z.object({
  type: z.literal("image"),
  url: z.url().optional(),
  path: z.string().optional(),
});

export const VideoSchema = z.object({
  type: z.literal("video"),
  url: z.url().optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailUrl: z.url().optional(),
});

export const MediaSchema = z.discriminatedUnion("type", [ImageSchema, VideoSchema]);

export const ContentSchema = z.object({
  text: z.string().optional(),
  media: z.array(MediaSchema).optional(),
});

export const PostSchema = z.object({
  content: ContentSchema,
  platforms: z.array(PlatformSchema),
});

export const PostMultiSchema = z.object({
  content: z.array(ContentSchema),
  platforms: z.array(PlatformSchema),
});

export type Platform = z.infer<typeof PlatformSchema>;
export type Image = z.infer<typeof ImageSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type Post = z.infer<typeof PostSchema>;
export type PostMulti = z.infer<typeof PostMultiSchema>;
