import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface ThreadsProfileResponse {
  id?: string;
  name?: string;
  threads_profile_picture_url?: string;
  username?: string;
}

async function fetchThreadsUser(accessToken: string): Promise<{ displayName?: string; userId: string; username?: string }> {
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
      async completeLogin({ tokenSet }) {
        return fetchThreadsUser(tokenSet.accessToken);
      },
    });
  }
}
