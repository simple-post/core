import { z } from "zod/v4";

export type LogLevel = "none" | "error" | "warn" | "info";

export const PlatformSchema = z.enum([
  "x",
  "youtube",
  "telegram",
  "facebook",
  "instagram",
  "tiktok",
  "bluesky",
  "threads",
  "linkedin",
  "pinterest",
]);

const BaseImageSchema = z.object({
  type: z.literal("image"),
  path: z.string().optional(),
  url: z.url().optional(),
  caption: z.string().optional(),
});

export const ImageSchema = BaseImageSchema.refine((data) => data.path || data.url, {
  message: "Either path or url must be provided",
});

const BaseVideoSchema = z.object({
  type: z.literal("video"),
  path: z.string().optional(),
  url: z.url().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailPath: z.string().optional(),
  thumbnailUrl: z.url().optional(),
});

export const VideoSchema = BaseVideoSchema.refine((data) => data.path || data.url, {
  message: "Either path or url must be provided",
});

export const MediaSchema = z.discriminatedUnion("type", [ImageSchema, VideoSchema]);

export const CommonOptionsSchema = z.object({
  logLevel: z.enum(["none", "error", "warn", "info"]).optional(),
  strictMode: z.boolean().optional(),
});

export const XAppCredentialsSchema = z.object({
  apiKey: z.string(),
  apiSecret: z.string(),
  accessToken: z.string(),
  accessSecret: z.string(),
});

export const XUserCredentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(), // Unix timestamp
});

// Union of the two credential types
export const XCredentialsSchema = z.union([XAppCredentialsSchema, XUserCredentialsSchema]);

export const XOptionsSchema = z.object({
  replyToId: z.string().optional(),
  credentials: XCredentialsSchema.optional(),
});

export const TelegramOptionsSchema = z.object({
  chatId: z.string(),
  parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional(),
  credentials: z
    .object({
      botToken: z.string(),
    })
    .optional(),
});

export const YouTubeOptionsSchema = z.object({
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  playlistId: z.string().optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  publishAt: z.string().optional(),
  privacyStatus: z.enum(["public", "private", "unlisted"]).optional(),
  credentials: z
    .union([
      // Option 1: OAuth2 with refresh token (for long-term access)
      z.object({
        clientId: z.string(),
        clientSecret: z.string(),
        refreshToken: z.string(),
      }),
      // Option 2: Direct access token (for short-term access)
      z.object({
        accessToken: z.string(),
      }),
    ])
    .optional(),
});

export const FacebookOptionsSchema = z.object({
  publishAt: z.string().optional(),
  credentials: z
    .object({
      pageAccessToken: z.string(),
      pageId: z.string(),
    })
    .optional(),
});

export const InstagramOptionsSchema = z.object({
  credentials: z
    .object({
      accessToken: z.string(),
      businessAccountId: z.string(),
      expiresAt: z.number().optional(),
    })
    .optional(),
});

export const TikTokOptionsSchema = z.object({
  publishMode: z.enum(["draft", "public"]).optional(),
  visibility: z.enum(["public", "friends", "private"]).optional(),
  allowComment: z.boolean().optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  credentials: z
    .object({
      accessToken: z.string(),
    })
    .optional(),
});

export const BlueskyOptionsSchema = z.object({
  credentials: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().optional(),
      did: z.string(),
      pdsUrl: z.url(),
      tokenUrl: z.string().optional(),
      clientId: z.string().optional(),
      dpopPublicJwk: z.record(z.string(), z.unknown()).optional(),
      dpopPrivateJwk: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const ThreadsOptionsSchema = z.object({
  credentials: z
    .object({
      accessToken: z.string(),
      userId: z.string(),
    })
    .optional(),
});

export const LinkedInOptionsSchema = z.object({
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
  credentials: z
    .object({
      accessToken: z.string(),
      memberId: z.string(),
    })
    .optional(),
});

export const PinterestOptionsSchema = z.object({
  boardId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  link: z.url().optional(),
  altText: z.string().optional(),
  credentials: z
    .object({
      accessToken: z.string(),
    })
    .optional(),
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
  tiktok: TikTokOptionsSchema.optional(),
  bluesky: BlueskyOptionsSchema.optional(),
  threads: ThreadsOptionsSchema.optional(),
  linkedin: LinkedInOptionsSchema.optional(),
  pinterest: PinterestOptionsSchema.optional(),
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
export type XAppCredentials = z.infer<typeof XAppCredentialsSchema>;
export type XUserCredentials = z.infer<typeof XUserCredentialsSchema>;
export type XCredentials = z.infer<typeof XCredentialsSchema>;
export type XOptions = z.infer<typeof XOptionsSchema>;
export type TelegramOptions = z.infer<typeof TelegramOptionsSchema>;
export type YouTubeOptions = z.infer<typeof YouTubeOptionsSchema>;
export type FacebookOptions = z.infer<typeof FacebookOptionsSchema>;
export type InstagramOptions = z.infer<typeof InstagramOptionsSchema>;
export type TikTokOptions = z.infer<typeof TikTokOptionsSchema>;
export type BlueskyOptions = z.infer<typeof BlueskyOptionsSchema>;
export type ThreadsOptions = z.infer<typeof ThreadsOptionsSchema>;
export type LinkedInOptions = z.infer<typeof LinkedInOptionsSchema>;
export type PinterestOptions = z.infer<typeof PinterestOptionsSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type PostOptions = z.infer<typeof PostOptionsSchema>;
export type Post = z.infer<typeof PostSchema>;

// Internal types for publishers that require credentials
export type XOptionsWithCredentials = XOptions & { credentials: NonNullable<XOptions["credentials"]> };
export type TelegramOptionsWithCredentials = TelegramOptions & {
  credentials: NonNullable<TelegramOptions["credentials"]>;
};
export type YouTubeOptionsWithCredentials = YouTubeOptions & {
  credentials: NonNullable<YouTubeOptions["credentials"]>;
};
export type FacebookOptionsWithCredentials = FacebookOptions & {
  credentials: NonNullable<FacebookOptions["credentials"]>;
};
export type InstagramOptionsWithCredentials = InstagramOptions & {
  credentials: NonNullable<InstagramOptions["credentials"]>;
};
export type TikTokOptionsWithCredentials = TikTokOptions & {
  credentials: NonNullable<TikTokOptions["credentials"]>;
};
export type BlueskyOptionsWithCredentials = BlueskyOptions & {
  credentials: NonNullable<BlueskyOptions["credentials"]>;
};
export type ThreadsOptionsWithCredentials = ThreadsOptions & {
  credentials: NonNullable<ThreadsOptions["credentials"]>;
};
export type LinkedInOptionsWithCredentials = LinkedInOptions & {
  credentials: NonNullable<LinkedInOptions["credentials"]>;
};
export type PinterestOptionsWithCredentials = PinterestOptions & {
  credentials: NonNullable<PinterestOptions["credentials"]>;
};

export type PostOptionsWithCredentials = PostOptions & {
  x?: XOptionsWithCredentials;
  telegram?: TelegramOptionsWithCredentials;
  youtube?: YouTubeOptionsWithCredentials;
  facebook?: FacebookOptionsWithCredentials;
  instagram?: InstagramOptionsWithCredentials;
  tiktok?: TikTokOptionsWithCredentials;
  bluesky?: BlueskyOptionsWithCredentials;
  threads?: ThreadsOptionsWithCredentials;
  linkedin?: LinkedInOptionsWithCredentials;
  pinterest?: PinterestOptionsWithCredentials;
};
