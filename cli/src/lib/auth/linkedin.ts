import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface LinkedInProfileResponse {
  email?: string;
  given_name?: string;
  name?: string;
  sub?: string;
}

async function fetchLinkedInUser(
  accessToken: string,
): Promise<{ displayName?: string; userId: string; username?: string }> {
  const response = await fetchJson<LinkedInProfileResponse>(
    "https://api.linkedin.com/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "LinkedIn user lookup",
  );

  if (!response.sub) {
    throw new Error("LinkedIn user lookup did not return a member id.");
  }

  return {
    displayName: response.name ?? response.given_name ?? response.email,
    userId: response.sub,
    username: response.email,
  };
}

export class LinkedInAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("linkedin", {
      async completeLogin({ tokenSet }) {
        return fetchLinkedInUser(tokenSet.accessToken);
      },
    });
  }
}
