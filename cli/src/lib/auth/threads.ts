import { OAuthAccountProvider, fetchJson } from "./oauth.js";

import type { OAuthTokenSet, ResolvedOAuthAppConfig } from "./oauth.js";
import type { AccountPlatform } from "../account/platforms.js";

interface ThreadsTokenExchangeResponse {
  access_token?: string;
  user_id?: string;
}

interface ThreadsProfileResponse {
  id?: string;
  name?: string;
  threads_profile_picture_url?: string;
  username?: string;
}

async function exchangeThreadsCode(input: {
  appConfig: ResolvedOAuthAppConfig;
  code: string;
  platform: AccountPlatform;
}): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({
    client_id: input.appConfig.clientId,
    redirect_uri: input.appConfig.redirectUri,
    grant_type: "authorization_code",
    code: input.code,
  });
  if (input.appConfig.clientSecret) {
    body.set("client_secret", input.appConfig.clientSecret);
  }

  const response = await fetchJson<ThreadsTokenExchangeResponse>(
    input.appConfig.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    "Threads token exchange",
  );

  if (!response.access_token) {
    throw new Error("Threads token exchange did not return an access token.");
  }

  return {
    accessToken: response.access_token,
    raw: response,
  };
}

async function fetchThreadsUser(
  accessToken: string,
): Promise<{ displayName?: string; userId: string; username?: string }> {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
  url.searchParams.set("access_token", accessToken);

  const response = await fetchJson<ThreadsProfileResponse>(url.toString(), { method: "GET" }, "Threads user lookup");
  if (!response.id) {
    throw new Error("Threads user lookup did not return an account id.");
  }

  return {
    displayName: response.name ?? response.username,
    userId: response.id,
    username: response.username,
  };
}

export class ThreadsAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("threads", {
      exchangeCode: exchangeThreadsCode,
      async completeLogin({ tokenSet }) {
        return fetchThreadsUser(tokenSet.accessToken);
      },
    });
  }
}
