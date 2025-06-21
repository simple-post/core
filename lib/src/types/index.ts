export enum PostErrorType {
  NO_ERROR = "NO_ERROR",
  INVALID_CONTENT = "INVALID_CONTENT",
  API_ERROR = "API_ERROR",
  OTHER = "OTHER",
}

export interface PostResult {
  id?: string;
  error: PostErrorType;
  message?: string;
  details?: any;
}
