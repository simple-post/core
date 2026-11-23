import { UnauthorizedError } from "@/lib/utils/errors";

import { OAUTH_ERROR_MESSAGES } from "./error-messages";
import { OAuthStateError } from "./state";

export type OAuthErrorCode =
  | "invalid_state"
  | "state_expired"
  | "session_mismatch"
  | "pkce_missing"
  | "missing_params"
  | "platform_mismatch"
  | "token_exchange_failed"
  | "profile_fetch_failed"
  | "youtube_no_channel"
  | "youtube_ambiguous_channel"
  | "no_access_token"
  | "authorization_denied"
  | "unknown_error";

export class OAuthCallbackError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OAuthCallbackError";
  }
}

export function getErrorRedirectUrl(code: OAuthErrorCode, baseUrl: string): string {
  const message = OAUTH_ERROR_MESSAGES[code];
  return `${baseUrl}/accounts?error=${encodeURIComponent(message)}`;
}

export function mapErrorToCode(error: unknown): OAuthErrorCode {
  if (error instanceof UnauthorizedError) return "session_mismatch";
  if (error instanceof OAuthCallbackError) return error.code;
  if (error instanceof OAuthStateError) {
    return error.code as OAuthErrorCode;
  }

  return "unknown_error";
}
