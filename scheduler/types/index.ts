import type { Prisma } from "@prisma/client";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile } from "@simple-post/sdk";

// Shared with @simple-post/server via @simple-post/sdk
export type { MediaFile, AccountContentOverride, AccountOverridesMap, AccountOptionsMap } from "@simple-post/sdk";

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
  scheduledFor: Date;
  status: "scheduled" | "pending" | "published" | "failed";
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  createdAt: Date;
  publishedAt?: Date;
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
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
