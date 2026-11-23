import { OAuthAccountProvider, type OAuthTokenSet, type OAuthProviderDependencies } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { OAuthAccountSecretPayload } from "../types.js";

function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tokenLifetime(source: unknown, key: string): number | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function refreshTikTokCredentials(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthAccountSecretPayload | null> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const response = await fetch(getAccountPlatformConfig("tiktok").oauthApp!.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await response.json().catch(() => null);
  const error = stringField(data, "error");
  if (!response.ok || error) {
    if (
      (response.ok || response.status === 400 || response.status === 401) &&
      (error === "invalid_grant" || error === "invalid_refresh_token" || error === "invalid_token")
    ) {
      return null;
    }
    throw new Error(`TikTok token refresh failed (HTTP ${response.status}). Try again shortly.`);
  }

  const accessToken = stringField(data, "access_token");
  const nextRefreshToken = stringField(data, "refresh_token");
  if (!accessToken || !nextRefreshToken) return null;

  const refreshExpiresIn = tokenLifetime(data, "refresh_expires_in");
  return {
    accessToken,
    expiresAt: issuedAt + (tokenLifetime(data, "expires_in") ?? 2 * 60 * 60),
    refreshToken: nextRefreshToken,
    ...(refreshExpiresIn === undefined ? {} : { refreshTokenExpiresAt: issuedAt + refreshExpiresIn }),
  };
}

function getTikTokUserId(tokenSet: OAuthTokenSet): string {
  const userId = stringField(tokenSet.raw, "open_id") ?? stringField(tokenSet.raw, "union_id");
  if (!userId) {
    throw new Error("TikTok token response did not return open_id or union_id.");
  }

  return userId;
}

export class TikTokAuthProvider extends OAuthAccountProvider {
  public constructor(dependencies?: OAuthProviderDependencies) {
    super(
      "tiktok",
      {
        async completeLogin({ tokenSet }) {
          if (!tokenSet.refreshToken?.trim()) {
            throw new Error("TikTok token response did not return a refresh token. Authorize the account again.");
          }
          const refreshExpiresIn = tokenLifetime(tokenSet.raw, "refresh_expires_in");
          return {
            userId: getTikTokUserId(tokenSet),
            secretPayload: refreshExpiresIn
              ? { refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + refreshExpiresIn }
              : undefined,
          };
        },
      },
      dependencies,
    );
  }
}
