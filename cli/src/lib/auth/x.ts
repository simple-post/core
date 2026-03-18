import { OAuthAccountProvider, fetchJson, generatePkcePair, parseOAuthCallbackUrl, resolveOAuthCallbackUrl, resolveStoredAccountAlias } from "./oauth.js";

import type { OAuthProviderDependencies } from "./oauth.js";
import type { AuthProviderContext, OAuthLoginFlags } from "./provider.js";
import type { StoredAccount } from "../types.js";

const X_ME_URL = "https://api.x.com/2/users/me?user.fields=profile_image_url,username,name";

interface XUserInfoResponse {
  data?: {
    id?: string;
    name?: string;
    username?: string;
  };
}

async function fetchCurrentUser(accessToken: string): Promise<{ displayName?: string; userId: string; username: string }> {
  const response = await fetchJson<XUserInfoResponse>(
    X_ME_URL,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "X user lookup",
  );

  const user = response.data;
  if (!user?.id || !user.username) {
    throw new Error("X user lookup did not return the expected account data.");
  }

  return {
    userId: user.id,
    username: user.username,
    displayName: user.name,
  };
}

export async function resolveXAlias(
  prompt: AuthProviderContext["prompt"],
  accounts: StoredAccount[],
  userId: string,
  username: string,
  requestedAlias?: string,
): Promise<string> {
  return resolveStoredAccountAlias(prompt, accounts, "x", userId, username, requestedAlias);
}

export async function resolveXCallbackUrl(
  context: AuthProviderContext,
  flags: OAuthLoginFlags,
  authUrl: string,
  redirectUri: string,
): Promise<string> {
  return resolveOAuthCallbackUrl(context, flags, authUrl, redirectUri, "X");
}

export class XAuthProvider extends OAuthAccountProvider {
  public constructor(dependencies?: OAuthProviderDependencies) {
    super(
      "x",
      {
        async completeLogin({ tokenSet }) {
          const user = await fetchCurrentUser(tokenSet.accessToken);
          return {
            displayName: user.displayName,
            userId: user.userId,
            username: user.username,
          };
        },
      },
      dependencies,
    );
  }
}

export { generatePkcePair, parseOAuthCallbackUrl };
