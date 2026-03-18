import { OAuthAccountProvider, fetchJson } from "./oauth.js";

import type { AuthProviderContext } from "./provider.js";

interface FacebookPagesResponse {
  data?: Array<{
    access_token?: string;
    id?: string;
    name?: string;
    picture?: { data?: { url?: string } };
  }>;
}

interface FacebookPageSelection {
  accessToken: string;
  displayName?: string;
  userId: string;
}

async function fetchFacebookPages(accessToken: string): Promise<FacebookPageSelection[]> {
  const response = await fetchJson<FacebookPagesResponse>(
    "https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,picture{url}",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
    "Facebook pages lookup",
  );

  return (response.data ?? []).flatMap((page) => {
    if (!page.id || !page.access_token) {
      return [];
    }

    return [
      {
        accessToken: page.access_token,
        displayName: page.name,
        userId: page.id,
      },
    ];
  });
}

async function chooseFacebookPage(prompt: AuthProviderContext["prompt"], pages: FacebookPageSelection[]): Promise<FacebookPageSelection> {
  if (pages.length === 0) {
    throw new Error("No Facebook Pages were returned. Make sure the account has at least one Page and granted pages permissions.");
  }

  if (pages.length === 1 || !prompt.interactive) {
    return pages[0];
  }

  const selected = await prompt.select(
    "Which Facebook Page should SimplePost post to?",
    pages.map((page) => ({
      description: page.userId,
      label: page.displayName ?? page.userId,
      value: page.userId,
    })),
    pages[0].userId,
  );

  return pages.find((page) => page.userId === selected) ?? pages[0];
}

export class FacebookAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("facebook", {
      async completeLogin({ context, tokenSet }) {
        const selectedPage = await chooseFacebookPage(context.prompt, await fetchFacebookPages(tokenSet.accessToken));
        return {
          displayName: selectedPage.displayName,
          secretPayload: {
            accessToken: selectedPage.accessToken,
          },
          userId: selectedPage.userId,
        };
      },
    });
  }
}
