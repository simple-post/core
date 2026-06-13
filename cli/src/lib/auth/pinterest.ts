import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface PinterestUserAccountResponse {
  id?: string;
  username?: string;
  profile_name?: string;
  business_name?: string;
}

async function fetchPinterestUser(
  accessToken: string,
): Promise<{ displayName?: string; userId: string; username?: string }> {
  const response = await fetchJson<PinterestUserAccountResponse>(
    "https://api.pinterest.com/v5/user_account",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "Pinterest user lookup",
  );

  const userId = response.id ?? response.username;
  if (!userId) {
    throw new Error("Pinterest user lookup did not return an account identifier.");
  }

  return {
    displayName: response.profile_name ?? response.business_name ?? response.username,
    userId,
    username: response.username,
  };
}

export class PinterestAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("pinterest", {
      async completeLogin({ tokenSet }) {
        return fetchPinterestUser(tokenSet.accessToken);
      },
    });
  }
}
