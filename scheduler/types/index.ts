export interface AccountPlatformOptions {
  x?: {
    replyToId?: string;
  };
  youtube?: {
    tags?: string[];
    categoryId?: string;
    playlistId?: string;
    selfDeclaredMadeForKids?: boolean;
    privacyStatus?: "public" | "private" | "unlisted";
    publishAt?: string;
  };
  tiktok?: {
    publishMode?: "draft" | "public";
    visibility?: "public" | "friends" | "private";
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
  };
  facebook?: {
    publishAt?: string;
  };
  instagram?: Record<string, never>;
  telegram?: {
    parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  };
}

// Map of accountId to account-specific options
export type AccountOptionsMap = Record<string, AccountPlatformOptions[keyof AccountPlatformOptions]>;

export interface AccountContentOverride {
  message?: string;
  media?: MediaFile[];
}

// Map of accountId to account-specific content overrides
export type AccountOverridesMap = Record<string, AccountContentOverride>;

export interface SocialPost {
  id: string;
  message: string;
  accountIds: string[]; // Changed from platforms to accountIds
  media: MediaFile[];
  scheduledFor: Date;
  status: "scheduled" | "published" | "failed";
  errorMessage?: string; // Human-readable error message when status is "failed"
  errorDetails?: Record<string, unknown>; // Detailed error info (platform errors, stack trace, etc.)
  createdAt: Date;
  publishedAt?: Date;
  accountOptions?: AccountOptionsMap; // Changed from platformOptions to accountOptions
  accountOverrides?: AccountOverridesMap;
}

// Keep old interface for backward compatibility during migration
export interface PlatformOptions {
  x?: {
    replyToId?: string;
  };
  youtube?: {
    tags?: string[];
    categoryId?: string;
    playlistId?: string;
    selfDeclaredMadeForKids?: boolean;
    privacyStatus?: "public" | "private" | "unlisted";
    publishAt?: string;
  };
  tiktok?: {
    publishMode?: "draft" | "public";
    visibility?: "public" | "friends" | "private";
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
  };
  facebook?: {
    publishAt?: string;
  };
  instagram?: Record<string, never>;
  telegram?: {
    parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  };
}

export interface MediaFile {
  id: string;
  url: string;
  thumbnailUrl?: string;
  type: "image" | "video";
  filename: string;
  size: number;
}

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: string;
  platformAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresAt: Date | null;
  scope: string | null;
  username: string | null;
  displayName: string | null;
  email: string | null;
  profilePicture: string | null;
  createdAt: Date;
  updatedAt: Date;
}
