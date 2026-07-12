import { z } from "zod";

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
  "forem",
  "farcaster",
]);

const BaseImageSchema = z.object({
  type: z.literal("image"),
  path: z.string().optional(),
  url: z.url().optional(),
  size: z.number().int().nonnegative().optional(),
  caption: z.string().optional(),
});

export const ImageSchema = BaseImageSchema.refine((data) => data.path || data.url, {
  message: "Either path or url must be provided",
});

const BaseVideoSchema = z.object({
  type: z.literal("video"),
  path: z.string().optional(),
  url: z.url().optional(),
  size: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnailPath: z.string().optional(),
  thumbnailUrl: z.url().optional(),
  durationSec: z.number().nonnegative().optional(),
});

export const VideoSchema = BaseVideoSchema.refine((data) => data.path || data.url, {
  message: "Either path or url must be provided",
});

export const MediaSchema = z.discriminatedUnion("type", [ImageSchema, VideoSchema]);

export const CommonOptionsSchema = z.object({
  logLevel: z.enum(["none", "error", "warn", "info"]).optional(),
  strictMode: z.boolean().optional(),
});

export const XCredentialsSchema = z
  .object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(), // Unix timestamp
    userId: z.string().optional(), // Numeric X user id; lets repost skip the users/me lookup
  })
  .refine((data) => Boolean(data.accessToken) || Boolean(data.clientId && data.refreshToken), {
    message: "X credentials require either accessToken, or clientId + refreshToken (or both)",
  });

export const XOptionsSchema = z.object({
  replyToId: z.string().optional(),
  credentials: XCredentialsSchema.optional(),
});

export const TelegramOptionsSchema = z.object({
  chatId: z.string(),
  parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional(),
  replyTo: z.string().optional(),
  credentials: z
    .object({
      botToken: z.string(),
    })
    .optional(),
});

export const YouTubeOptionsSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  playlistId: z.string().optional(),
  thumbnailPath: z.string().optional(),
  thumbnailUrl: z.url().optional(),
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
      graphApi: z.enum(["instagram", "facebook"]).optional(),
      expiresAt: z.number().optional(),
    })
    .optional(),
});

export const TikTokPrivacyLevelSchema = z.enum([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

export const TikTokOptionsSchema = z.object({
  title: z.string().max(2200).optional(),
  publishMode: z.enum(["draft", "public"]).optional(),
  privacyLevel: TikTokPrivacyLevelSchema.optional(),
  visibility: z.enum(["public", "friends", "private"]).optional(),
  allowComment: z.boolean().optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  commercialContentDisclosure: z.boolean().optional(),
  discloseYourBrand: z.boolean().optional(),
  discloseBrandedContent: z.boolean().optional(),
  credentials: z
    .object({
      accessToken: z.string(),
    })
    .optional(),
});

export const BlueskyOAuthCredentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  did: z.string(),
  pdsUrl: z.url(),
  tokenUrl: z.string().optional(),
  clientId: z.string().optional(),
  dpopPublicJwk: z.record(z.string(), z.unknown()).optional(),
  dpopPrivateJwk: z.record(z.string(), z.unknown()).optional(),
});

export const BlueskyAppPasswordCredentialsSchema = z.object({
  identifier: z.string(),
  appPassword: z.string(),
  pdsUrl: z.url().optional(),
});

export const BlueskyCredentialsSchema = z.union([BlueskyAppPasswordCredentialsSchema, BlueskyOAuthCredentialsSchema]);

export const BlueskyPostRefSchema = z.object({
  uri: z.string(),
  cid: z.string(),
});

export const BlueskyReplyRefSchema = z.object({
  root: BlueskyPostRefSchema,
  parent: BlueskyPostRefSchema,
});

export const BlueskyOptionsSchema = z.object({
  replyTo: BlueskyReplyRefSchema.optional(),
  credentials: BlueskyCredentialsSchema.optional(),
});

export const ThreadsOptionsSchema = z.object({
  replyToId: z.string().optional(),
  credentials: z
    .object({
      accessToken: z.string(),
      userId: z.string(),
      expiresAt: z.number().optional(),
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
export const ForemOptionsSchema = z.object({
  title: z.string().min(1).optional(),
  published: z.boolean().optional(),
  tags: z.array(z.string()).max(4).optional(),
  series: z.string().nullable().optional(),
  canonicalUrl: z.url().nullable().optional(),
  description: z.string().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  credentials: z.object({ instanceUrl: z.url(), apiKey: z.string().min(1) }).optional(),
});
export const FarcasterOptionsSchema = z.object({
  hubUrl: z.string().min(1),
  username: z.string().optional(),
  credentials: z.object({ fid: z.number().int().positive(), signerPrivateKey: z.string().min(1) }).optional(),
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
  forem: ForemOptionsSchema.optional(),
  farcaster: FarcasterOptionsSchema.optional(),
});

export const PostSchema = z.object({
  content: ContentSchema,
  platforms: z.array(PlatformSchema),
  options: PostOptionsSchema.optional(),
});

export const RepostTargetSchema = z.object({
  postId: z.string().min(1),
  uri: z.string().optional(),
  cid: z.string().optional(),
});

export const RepostSchema = z.object({
  target: RepostTargetSchema,
  platforms: z.array(PlatformSchema),
  options: PostOptionsSchema.optional(),
});

// Quote targets use the same platform identifiers as reposts. Bluesky needs
// the record uri/cid pair in addition to the public post id; other platforms
// use postId directly.
export const QuoteTargetSchema = RepostTargetSchema;

export const QuoteSchema = z
  .object({
    content: ContentSchema,
    target: QuoteTargetSchema.optional(),
    targets: z.partialRecord(PlatformSchema, QuoteTargetSchema).optional(),
    platforms: z.array(PlatformSchema),
    options: PostOptionsSchema.optional(),
  })
  .refine((data) => data.target || (data.targets && Object.keys(data.targets).length > 0), {
    message: "Either target or targets is required",
  });

export type Platform = z.infer<typeof PlatformSchema>;
export type Image = z.infer<typeof ImageSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type CommonOptions = z.infer<typeof CommonOptionsSchema>;
export type XCredentials = z.infer<typeof XCredentialsSchema>;
export type XOptions = z.infer<typeof XOptionsSchema>;
export type TelegramOptions = z.infer<typeof TelegramOptionsSchema>;
export type YouTubeOptions = z.infer<typeof YouTubeOptionsSchema>;
export type FacebookOptions = z.infer<typeof FacebookOptionsSchema>;
export type InstagramOptions = z.infer<typeof InstagramOptionsSchema>;
export type TikTokOptions = z.infer<typeof TikTokOptionsSchema>;
export type TikTokPrivacyLevel = z.infer<typeof TikTokPrivacyLevelSchema>;
export type BlueskyOAuthCredentials = z.infer<typeof BlueskyOAuthCredentialsSchema>;
export type BlueskyAppPasswordCredentials = z.infer<typeof BlueskyAppPasswordCredentialsSchema>;
export type BlueskyCredentials = z.infer<typeof BlueskyCredentialsSchema>;
export type BlueskyPostRef = z.infer<typeof BlueskyPostRefSchema>;
export type BlueskyReplyRef = z.infer<typeof BlueskyReplyRefSchema>;
export type BlueskyOptions = z.infer<typeof BlueskyOptionsSchema>;
export type ThreadsOptions = z.infer<typeof ThreadsOptionsSchema>;
export type LinkedInOptions = z.infer<typeof LinkedInOptionsSchema>;
export type PinterestOptions = z.infer<typeof PinterestOptionsSchema>;
export type ForemOptions = z.infer<typeof ForemOptionsSchema>;
export type FarcasterOptions = z.infer<typeof FarcasterOptionsSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type PostOptions = z.infer<typeof PostOptionsSchema>;
export type Post = z.infer<typeof PostSchema>;
export type RepostTarget = z.infer<typeof RepostTargetSchema>;
export type Repost = z.infer<typeof RepostSchema>;
export type QuoteTarget = z.infer<typeof QuoteTargetSchema>;
export type QuoteTargets = Partial<Record<Platform, QuoteTarget>>;
export type Quote = z.infer<typeof QuoteSchema>;

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
export type ForemOptionsWithCredentials = ForemOptions & { credentials: NonNullable<ForemOptions["credentials"]> };
export type FarcasterOptionsWithCredentials = FarcasterOptions & {
  credentials: NonNullable<FarcasterOptions["credentials"]>;
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
  forem?: ForemOptionsWithCredentials;
  farcaster?: FarcasterOptionsWithCredentials;
};
