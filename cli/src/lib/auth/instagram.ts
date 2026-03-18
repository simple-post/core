import { OAuthAccountProvider, fetchJson } from "./oauth.js";

import type { ResolvedOAuthAppConfig } from "./oauth.js";

interface InstagramTokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
}

interface InstagramProfileResponse {
  id?: string;
  name?: string;
  profile_picture_url?: string;
  user_id?: string;
  username?: string;
}

async function exchangeForLongLivedToken(
  shortLivedToken: string,
  appConfig: ResolvedOAuthAppConfig,
): Promise<{ accessToken: string; expiresAt: number }> {
  if (!appConfig.clientSecret) {
    throw new Error(`Connecting Instagram requires ${appConfig.clientSecretEnvVar} in the environment for long-lived tokens.`);
  }

  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appConfig.clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetchJson<InstagramTokenExchangeResponse>(url.toString(), { method: "GET" }, "Instagram long-lived token exchange");
  if (!response.access_token || typeof response.expires_in !== "number") {
    throw new Error("Instagram did not return the expected long-lived token response.");
  }

  return {
    accessToken: response.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + response.expires_in,
  };
}

async function fetchInstagramProfile(accessToken: string): Promise<{ displayName?: string; userId: string; username?: string }> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username,name,profile_picture_url,account_type");
  url.searchParams.set("access_token", accessToken);

  const response = await fetchJson<InstagramProfileResponse>(url.toString(), { method: "GET" }, "Instagram profile lookup");
  const userId = response.user_id ?? response.id;
  if (!userId) {
    throw new Error("Instagram profile lookup did not return a business account id.");
  }

  return {
    displayName: response.name ?? response.username,
    userId,
    username: response.username,
  };
}

export class InstagramAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("instagram", {
      async completeLogin({ appConfig, tokenSet }) {
        const longLived = await exchangeForLongLivedToken(tokenSet.accessToken, appConfig);
        const profile = await fetchInstagramProfile(longLived.accessToken);
        return {
          displayName: profile.displayName,
          secretPayload: {
            accessToken: longLived.accessToken,
            expiresAt: longLived.expiresAt,
          },
          userId: profile.userId,
          username: profile.username,
        };
      },
    });
  }
}
