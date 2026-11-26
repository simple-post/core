import type { Platform } from "./post";

export type SocialActivityCapability = "comments" | "replies" | "quotes" | "likes";
export type SocialActivityErrorCode =
  | "unsupported"
  | "invalid_request"
  /** A write may have reached the provider; reconcile before sending again. */
  | "uncertain"
  | "permission_required"
  | "authentication"
  | "not_found"
  | "rate_limited"
  | "transient"
  | "invalid_response";

export interface SocialActivityError {
  code: SocialActivityErrorCode;
  /** Safe user-facing detail; no provider response bodies or credentials. */
  message: string;
  retryAfterSeconds?: number;
}

export type SocialActivityResult<T> = { ok: true; data: T } | { ok: false; error: SocialActivityError };

export interface SocialActivityPage<T> {
  data: T[];
  nextCursor?: string;
  /** APIs with limited retention describe their coverage here. */
  coverage?: string;
}

export interface SocialActivityAccount {
  platform: Platform | string;
  accountId: string;
  platformAccountId: string;
  accessToken: string;
  username?: string;
  /** Platform-specific connection metadata, supplied only by a trusted server. */
  credentials?: Record<string, unknown>;
}

export interface SocialActivityPostTarget {
  nativePostId: string;
  nativeUrl?: string;
  platformData?: Record<string, unknown>;
  publishedAt?: string;
}

export interface SocialActor {
  id?: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
}

export interface SocialComment {
  nativeId: string;
  nativePostId: string;
  nativeUrl?: string;
  body: string;
  createdAt?: string;
  author?: SocialActor;
  likeCount?: number;
  replyCount?: number;
  parentNativeId?: string;
  kind?: "comment" | "reply" | "quote";
  canReply: boolean;
  canLike?: boolean;
  liked?: boolean;
  /** Opaque provider reference retained by the trusted scheduler only. */
  replyTarget?: Record<string, unknown>;
}

export interface SocialReplyRequest {
  account: SocialActivityAccount;
  target: SocialComment;
  text: string;
}

export type SocialLikeRequest = Pick<SocialReplyRequest, "account" | "target">;

export interface SocialLike {
  liked: true;
}

export interface SocialReply {
  nativeId: string;
  nativeUrl?: string;
  createdAt: string;
}

export interface SocialActivityProvider {
  readonly platform: string;
  getCapabilities(): ReadonlySet<SocialActivityCapability>;
  listPostComments?(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options?: { cursor?: string; limit?: number },
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>>;
  listPostQuotes?(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options?: { cursor?: string; limit?: number },
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>>;
  likeItem?(request: SocialLikeRequest): Promise<SocialActivityResult<SocialLike>>;
  replyToComment?(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>>;
}
