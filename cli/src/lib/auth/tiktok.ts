import { OAuthAccountProvider, fetchJson } from "./oauth.js";

import type { OAuthTokenSet, ResolvedOAuthAppConfig } from "./oauth.js";

interface TikTokTokenResponse {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface TikTokUserInfoResponse {
  data?: {
    user?: {
      avatar_url?: string;
      display_name?: string;
      open_id?: string;
      union_id?: string;
      username?: string;
    };
  };
}

async function exchangeTikTokCode(input: {
  appConfig: ResolvedOAuthAppConfig;
  code: string;
}): Promise<OAuthTokenSet> {
  if (!input.appConfig.clientSecret) {
    throw new Error(`Connecting TikTok requires ${input.appConfig.clientSecretEnvVar} in the environment for token exchange.`);
  }

  const body = new URLSearchParams({
    client_key: input.appConfig.clientId,
    client_secret: input.appConfig.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.appConfig.redirectUri,
  });

  const response = await fetchJson<TikTokTokenResponse>(
    input.appConfig.tokenUrl,
    {
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    "TikTok token exchange",
  );

  if (!response.access_token) {
    throw new Error("TikTok token exchange returned no access token.");
  }

  return {
    accessToken: response.access_token,
    expiresAt: typeof response.expires_in === "number" ? Math.floor(Date.now() / 1000) + response.expires_in : undefined,
    raw: response,
    refreshToken: response.refresh_token,
  };
}

async function fetchTikTokUser(accessToken: string): Promise<{ displayName?: string; userId: string; username?: string }> {
  const response = await fetchJson<TikTokUserInfoResponse>(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "TikTok user lookup",
  );

  const user = response.data?.user;
  const userId = user?.open_id ?? user?.union_id;
  if (!userId) {
    throw new Error("TikTok user lookup did not return an account identifier.");
  }

  return {
    displayName: user?.display_name,
    userId,
    username: user?.username,
  };
}

export class TikTokAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("tiktok", {
      async completeLogin({ tokenSet }) {
        return fetchTikTokUser(tokenSet.accessToken);
      },
      exchangeCode({ appConfig, code }) {
        return exchangeTikTokCode({ appConfig, code });
      },
    });
  }
}
