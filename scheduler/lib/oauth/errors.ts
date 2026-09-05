import { UnauthorizedError } from "@/lib/utils/errors";

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

const ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  invalid_state: "Invalid authorization request. Please try connecting again.",
  state_expired: "Authorization request expired. Please try connecting again.",
  session_mismatch: "Session mismatch. Please log in and try again.",
  pkce_missing: "Authorization verification failed. Please try connecting again.",
  missing_params: "Missing authorization parameters. Please try connecting again.",
  platform_mismatch: "Platform mismatch in authorization request.",
  token_exchange_failed: "Failed to complete authorization. Please try again.",
  profile_fetch_failed: "Failed to fetch account profile. Please try again.",
  no_access_token: "No access token received. Please try again.",
  authorization_denied: "Authorization was denied.",
  unknown_error: "An unexpected error occurred. Please try again.",
};

export function getErrorRedirectUrl(code: OAuthErrorCode, baseUrl: string): string {
  const message = ERROR_MESSAGES[code];
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
