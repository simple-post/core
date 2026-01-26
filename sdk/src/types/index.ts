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
  error: PostErrorType;
  message?: string;
  details?: unknown;
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}
