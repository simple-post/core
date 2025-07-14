import { z } from "zod/v4";

export type LogLevel = "none" | "error" | "warn" | "info";

export const PlatformSchema = z.enum([
  "x",
  "youtube",
  "telegram",
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "pinterest",
]);

export const ImageSchema = z.object({
  type: z.literal("image"),
  path: z.string(),
  caption: z.string().optional(),
});

export const VideoSchema = z.object({
  type: z.literal("video"),
  path: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailPath: z.string().optional(),
});

export const MediaSchema = z.discriminatedUnion("type", [ImageSchema, VideoSchema]);

export const CommonOptionsSchema = z.object({
  logLevel: z.enum(["none", "error", "warn", "info"]).optional(),
  strictMode: z.boolean().optional(),
  privacyStatus: z.enum(["public", "private", "unlisted"]).optional(),
});

export const XOptionsSchema = z.object({
  replyToId: z.string().optional(),
  credentials: z.object({
    apiKey: z.string(),
    apiSecret: z.string(),
    accessToken: z.string(),
    accessSecret: z.string(),
  }),
});

export const TelegramOptionsSchema = z.object({
  chatId: z.string(),
  parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional(),
  credentials: z.object({
    botToken: z.string(),
  }),
});

export const YouTubeOptionsSchema = z.object({
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  playlistId: z.string().optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  credentials: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    refreshToken: z.string(),
  }),
});

export const FacebookOptionsSchema = z.object({
  credentials: z.object({
    pageAccessToken: z.string(),
    pageId: z.string(),
  }),
});

export const InstagramOptionsSchema = z.object({
  credentials: z.object({
    accessToken: z.string(),
    businessAccountId: z.string(),
  }),
});

export const ContentSchema = z.object({
  text: z.string().optional(),
  media: z.array(MediaSchema).optional(),
});

export const PostOptionsSchema = z.object({
  common: CommonOptionsSchema.optional(),
  x: XOptionsSchema.optional(),
  telegram: TelegramOptionsSchema.optional(),
  youtube: YouTubeOptionsSchema.optional(),
  facebook: FacebookOptionsSchema.optional(),
  instagram: InstagramOptionsSchema.optional(),
});

export const PostSchema = z.object({
  content: ContentSchema,
  platforms: z.array(PlatformSchema),
  options: PostOptionsSchema.optional(),
});

export type Platform = z.infer<typeof PlatformSchema>;
export type Image = z.infer<typeof ImageSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type CommonOptions = z.infer<typeof CommonOptionsSchema>;
export type XOptions = z.infer<typeof XOptionsSchema>;
export type TelegramOptions = z.infer<typeof TelegramOptionsSchema>;
export type YouTubeOptions = z.infer<typeof YouTubeOptionsSchema>;
export type FacebookOptions = z.infer<typeof FacebookOptionsSchema>;
export type InstagramOptions = z.infer<typeof InstagramOptionsSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type PostOptions = z.infer<typeof PostOptionsSchema>;
export type Post = z.infer<typeof PostSchema>;
