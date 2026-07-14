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
export type RepostStatus = "not_applicable" | "scheduled" | "pending" | "completed" | "failed";
export type ConnectedAccountCredentialState =
  | "healthy"
  | "non_expiring"
  | "refreshing_soon"
  | "refresh_unavailable"
  | "reauth_required"
  | "unknown";

export interface ConnectedAccountCredentialStatus {
  state: ConnectedAccountCredentialState;
  severity: "ok" | "warning" | "error";
  label: string;
  message: string;
  action: "none" | "refresh" | "reconnect";
  canRefresh: boolean;
  expiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshError: string | null;
}

export interface AccountPlatformOptions {
  x?: {
    replyToId?: string;
  };
  youtube?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    playlistId?: string;
    thumbnailUrl?: string;
    selfDeclaredMadeForKids?: boolean;
    privacyStatus?: "public" | "private" | "unlisted";
    publishAt?: string;
  };
  tiktok?: {
    title?: string;
    publishMode?: "draft" | "public";
    privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
    visibility?: "public" | "friends" | "private";
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
    commercialContentDisclosure?: boolean;
    discloseYourBrand?: boolean;
    discloseBrandedContent?: boolean;
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
  forem?: {
    title?: string;
    published?: boolean;
    tags?: string[];
    series?: string | null;
    canonicalUrl?: string | null;
    description?: string;
    organizationId?: number | null;
  };
  farcaster?: { hubUrl?: string; snapchainUrls?: string[]; signerTtlSeconds?: number; username?: string };
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
  repostEnabled?: boolean;
  repostDelayHours?: number;
  repostDueAt?: Date | null;
  repostStatus?: RepostStatus;
  repostedAt?: Date | null;
  repostResults?: AccountResultsMap | null;
  repostErrorMessage?: string | null;
  repostErrorDetails?: Record<string, unknown> | null;
  thread?: ThreadSegment[];
  threadResults?: Record<string, ThreadSegmentResult[]> | null;
  accountResults?: AccountResultsMap | null;
  quotePostId?: string | null;
  idempotencyKey?: string | null;
}

// Outcome of publishing to a single connected account, persisted on the post
// so that retries of partially failed posts can skip accounts that already
// published successfully.
export interface AccountPublishResult {
  accountId: string;
  platform: string;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  message?: string;
  completedAt: string;
  platformData?: Record<string, unknown>;
}

export type AccountResultsMap = Record<string, AccountPublishResult>;

// Legacy shape kept for backward compatibility.
export interface PlatformOptions {
  x?: {
    replyToId?: string;
  };
  youtube?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    playlistId?: string;
    thumbnailUrl?: string;
    selfDeclaredMadeForKids?: boolean;
    privacyStatus?: "public" | "private" | "unlisted";
    publishAt?: string;
  };
  tiktok?: {
    title?: string;
    publishMode?: "draft" | "public";
    privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
    visibility?: "public" | "friends" | "private";
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
    commercialContentDisclosure?: boolean;
    discloseYourBrand?: boolean;
    discloseBrandedContent?: boolean;
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
  forem?: {
    title?: string;
    published?: boolean;
    tags?: string[];
    series?: string | null;
    canonicalUrl?: string | null;
    description?: string;
    organizationId?: number | null;
  };
  farcaster?: { hubUrl?: string; snapchainUrls?: string[]; signerTtlSeconds?: number; username?: string };
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
  credentialStatus?: ConnectedAccountCredentialStatus;
}
