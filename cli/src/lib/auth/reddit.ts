import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface RedditMeResponse {
  id?: string;
  name?: string;
  icon_img?: string;
}

export class RedditAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("reddit", {
      async completeLogin({ tokenSet }) {
        const profile = await fetchJson<RedditMeResponse>(
          "https://oauth.reddit.com/api/v1/me",
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${tokenSet.accessToken}`,
              "User-Agent": "web:SimplePost:1.0 (https://simplepost.social)",
            },
          },
          "Reddit user lookup",
        );
        if (!profile.id || !profile.name) throw new Error("Reddit user lookup did not return an account identifier.");
        return { userId: profile.id, username: profile.name, displayName: profile.name };
      },
    });
  }
}
