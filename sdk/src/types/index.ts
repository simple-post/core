export enum PostErrorType {
  NO_ERROR = "NO_ERROR",
  CREDENTIALS_ERROR = "CREDENTIALS_ERROR",
  INVALID_CONTENT = "INVALID_CONTENT",
  API_ERROR = "API_ERROR",
  OTHER = "OTHER",
}

export class PostError extends Error {
  public errorType: PostErrorType;
  public details?: unknown;

  constructor(errorType: PostErrorType, message: string, details?: unknown) {
    super(message);
    this.name = "PostError";
    this.errorType = errorType;
    this.message = message;
    this.details = details;
  }
}

export interface PostResult {
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
