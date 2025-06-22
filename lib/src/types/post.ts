import { z } from "zod/v4";

export const PlatformSchema = z.enum(["x", "youtube", "facebook", "instagram", "tiktok", "linkedin", "pinterest"]);

export const ImageSchema = z.object({
  type: z.literal("image"),
  path: z.string().optional(),
});

export const VideoSchema = z.object({
  type: z.literal("video"),
  path: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailPath: z.string().optional(),
});

export const MediaSchema = z.discriminatedUnion("type", [ImageSchema, VideoSchema]);

export const YouTubeSpecificOptionsSchema = z.object({
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  playlistId: z.string().optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
});

export const ContentOptionsSchema = z.object({
  privacyStatus: z.enum(["public", "private", "unlisted"]).optional(),
  youtubeSpecific: YouTubeSpecificOptionsSchema.optional(),
});

export const ContentSchema = z.object({
  text: z.string().optional(),
  media: z.array(MediaSchema).optional(),
  options: ContentOptionsSchema.optional(),
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
export type YouTubeSpecificOptions = z.infer<typeof YouTubeSpecificOptionsSchema>;
export type ContentOptions = z.infer<typeof ContentOptionsSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type Post = z.infer<typeof PostSchema>;
export type PostMulti = z.infer<typeof PostMultiSchema>;
