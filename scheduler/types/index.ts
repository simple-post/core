import type { Prisma } from "@prisma/client";
import type {
  AccountOptionsMap,
  AccountOverridesMap,
  MediaFile,
  ThreadSegment,
  ThreadSegmentResult,
} from "@simple-post/sdk";

// Shared with @simple-post/server via @simple-post/sdk
export type {
  MediaFile,
  AccountContentOverride,
  AccountOverridesMap,
  AccountOptionsMap,
  ThreadSegment,
  ThreadSegmentResult,
} from "@simple-post/sdk";

export type PostingMode = "now" | "schedule" | "draft";
export type PostStatus = "draft" | "scheduled" | "pending" | "published" | "failed";

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
  bluesky?: Record<string, never>;
  threads?: Record<string, never>;
  linkedin?: {
    visibility?: "PUBLIC" | "CONNECTIONS";
  };
  pinterest?: {
    boardId?: string;
    title?: string;
    description?: string;
    link?: string;
    altText?: string;
  };
}

export interface SocialPost {
  id: string;
  message: string;
  accountIds: string[];
  media: MediaFile[];
  scheduledFor: Date | null;
  status: PostStatus;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  createdAt: Date;
  publishedAt?: Date | null;
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
  threadResults?: Record<string, ThreadSegmentResult[]> | null;
}

// Legacy shape kept for backward compatibility.
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
  bluesky?: Record<string, never>;
  threads?: Record<string, never>;
  linkedin?: {
    visibility?: "PUBLIC" | "CONNECTIONS";
  };
  pinterest?: {
    boardId?: string;
    title?: string;
    description?: string;
    link?: string;
    altText?: string;
  };
}

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: string;
  platformAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenMetadata?: Prisma.JsonValue | null;
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
