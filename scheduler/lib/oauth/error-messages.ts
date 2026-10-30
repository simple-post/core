import type { OAuthErrorCode } from "./errors";

export const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  invalid_state: "Invalid authorization request. Please try connecting again.",
  state_expired: "Authorization request expired. Please try connecting again.",
  session_mismatch: "Session mismatch. Please log in and try again.",
  pkce_missing: "Authorization verification failed. Please try connecting again.",
  missing_params: "Missing authorization parameters. Please try connecting again.",
  platform_mismatch: "Platform mismatch in authorization request.",
  token_exchange_failed: "Failed to complete authorization. Please try again.",
  profile_fetch_failed: "Failed to fetch account profile. Please try again.",
  youtube_no_channel:
    "No YouTube channel was authorized. Connect again and select the Google account or Brand Account that owns your channel. YouTube Studio invitations alone do not grant API access.",
  youtube_ambiguous_channel:
    "Could not identify a single YouTube channel. Connect again and select the specific channel or Brand Account you want to use.",
  no_access_token: "No access token received. Please try again.",
  authorization_denied: "Authorization was denied.",
  unknown_error: "An unexpected error occurred. Please try again.",
};

export const FACEBOOK_NO_PAGES_MESSAGE =
  "No Facebook Pages found. Make sure you have a Facebook Page connected to your account.";

/** Query strings are untrusted: only display messages from our own callbacks. */
export function knownOAuthErrorMessage(value: string | null): string | null {
  return value && [...Object.values(OAUTH_ERROR_MESSAGES), FACEBOOK_NO_PAGES_MESSAGE].includes(value) ? value : null;
}
