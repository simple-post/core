import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface GoogleUserInfoResponse {
  email?: string;
  id?: string;
  name?: string;
}

async function fetchYouTubeUser(accessToken: string): Promise<{ displayName?: string; userId: string; username?: string }> {
  const response = await fetchJson<GoogleUserInfoResponse>(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "Google user lookup",
  );

  const userId = response.id ?? response.email;
  if (!userId) {
    throw new Error("Google user lookup did not return an account identifier.");
  }

  return {
    displayName: response.name,
    userId,
    username: response.email,
  };
}

export class YouTubeAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("youtube", {
      async completeLogin({ tokenSet }) {
        return fetchYouTubeUser(tokenSet.accessToken);
      },
    });
  }
}
