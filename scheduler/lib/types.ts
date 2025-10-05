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
}

// Map of accountId to account-specific options
export type AccountOptionsMap = Record<string, AccountPlatformOptions[keyof AccountPlatformOptions]>;

export interface SocialPost {
  id: string;
  message: string;
  accountIds: string[]; // Changed from platforms to accountIds
  media: MediaFile[];
  scheduledFor: Date;
  status: "scheduled" | "published" | "failed";
  createdAt: Date;
  publishedAt?: Date;
  accountOptions?: AccountOptionsMap; // Changed from platformOptions to accountOptions
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
}

export interface MediaFile {
  id: string;
  url: string;
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

export interface PostsRepository {
  getScheduledPosts(): Promise<SocialPost[]>;
  getPastPosts(): Promise<SocialPost[]>;
  createPost(post: Omit<SocialPost, "id" | "createdAt">): Promise<SocialPost>;
  updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost>;
  deletePost(id: string): Promise<void>;
}
