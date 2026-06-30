/**
 * Shared list of sensitive field names used by every redaction layer
 * (server logger, Telegram transport, and the client logger). Kept in a
 * dependency-free module so it can be imported from both server and browser
 * bundles without pulling in pino.
 */

/** Exact key names redacted by the server `redact()` helper and pino config. */
export const SENSITIVE_KEYS = [
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "apiKey",
  "api_key",
  "credentials",
  "authorization",
  "cookie",
  "token",
  "clientSecret",
  "client_secret",
  "botToken",
  "bot_token",
] as const;

/**
 * Substrings used for fuzzy key matching on the client, where keys may use
 * varied casing/separators. Covers every variant in SENSITIVE_KEYS.
 */
export const SENSITIVE_KEY_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "credential",
] as const;

/** Normalize a key to lowercase with separators stripped, then substring-match. */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("-", "").replaceAll("_", "");
  return SENSITIVE_KEY_SUBSTRINGS.some((part) => normalized.includes(part));
}
