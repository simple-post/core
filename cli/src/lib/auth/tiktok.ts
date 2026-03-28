import { OAuthAccountProvider, fetchJson } from "./oauth.js";

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
    });
  }
}
