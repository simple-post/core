export enum PostErrorType {
  NO_ERROR = "NO_ERROR",
  CREDENTIALS_ERROR = "CREDENTIALS_ERROR",
  /** A conclusive quota rejection with no publication; never use for an uncertain transport outcome. */
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR",
  INVALID_CONTENT = "INVALID_CONTENT",
  /** Media preparation failed before any publishing request was submitted. */
  PREPARATION_ERROR = "PREPARATION_ERROR",
  /** The provider explicitly rejected the request without publishing a post. */
  PUBLISH_REJECTED = "PUBLISH_REJECTED",
  API_ERROR = "API_ERROR",
  OTHER = "OTHER",
}

export interface PublishRecovery {
  outcome: "not_published" | "processing" | "unknown";
  retryable: boolean;
  phase: string;
  httpStatus?: number;
  providerCode?: string;
  retryAfterMs?: number;
}

export interface TikTokVideoJob {
  publishId: string;
  phase: "initialized" | "uploading" | "uploaded";
  fileSize: number;
  uploadedBytes: number;
  /** Persisted before sending a chunk, including before the final chunk. */
  attemptedBytes: number;
}

export interface TikTokVideoRecovery {
  onProgress: (job: TikTokVideoJob) => Promise<void>;
}

export class PostError extends Error {
  public errorType: PostErrorType;
  public details?: unknown;

  constructor(
    errorType: PostErrorType,
    message: string,
    details?: unknown,
    public recovery?: PublishRecovery,
  ) {
    super(message);
    this.name = "PostError";
    this.errorType = errorType;
    this.message = message;
    this.details = details;
  }
}

export interface PostResult {
  recovery?: PublishRecovery;
  id?: string;
  /**
   * Canonical public URL of the published post when the platform exposes one
   * (e.g. Instagram/Threads permalink, TikTok video URL). Publishers should
   * populate this whenever they have authoritative data; consumers should
   * prefer it over manually constructing URLs from `id`.
   */
  url?: string;
  error: PostErrorType;
  message?: string;
  details?: unknown;
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
    platformData?: Record<string, unknown>;
  };
}

export type RepostResult = PostResult;
export type QuoteResult = PostResult;
