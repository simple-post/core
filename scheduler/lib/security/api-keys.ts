import crypto from "node:crypto";

export const API_KEY_PREFIX = "sp_api_";
export const API_KEY_PREVIEW_LENGTH = 12;

export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, API_KEY_PREVIEW_LENGTH);
}

export function isApiKey(apiKey: string): boolean {
  return apiKey.startsWith(API_KEY_PREFIX);
}
