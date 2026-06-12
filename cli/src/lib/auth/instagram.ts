import {
  exchangeFacebookCode,
  fetchFacebookPages,
  fetchFacebookPermissionsHint,
  graphUrlWithAccessToken,
  startFacebookAuthorization,
  type FacebookPageSelection,
} from "./facebook.js";
import { OAuthAccountProvider, fetchJson } from "./oauth.js";

import type { AuthProviderContext } from "./provider.js";

interface InstagramBusinessAccount {
  id?: string;
  username?: string;
}

interface InstagramPageLookupResponse {
  instagram_business_account?: InstagramBusinessAccount;
}

interface InstagramLinkedAccountSelection {
  instagramBusinessAccountId: string;
  instagramUsername?: string;
  pageAccessToken: string;
  pageId: string;
  pageName?: string;
}

async function fetchInstagramBusinessAccountForPage(
  page: FacebookPageSelection,
  userAccessToken: string,
): Promise<InstagramLinkedAccountSelection | null> {
  const lookup = async (accessToken: string): Promise<InstagramBusinessAccount | null> => {
    const response = await fetchJson<InstagramPageLookupResponse>(
      graphUrlWithAccessToken(`${page.userId}?fields=instagram_business_account{id,username}`, accessToken),
      { method: "GET" },
      "Facebook Instagram business account lookup",
    );
    return response.instagram_business_account ?? null;
  };

  try {
    const igAccount = await lookup(page.accessToken).catch(() => lookup(userAccessToken));
    if (!igAccount?.id) {
      return null;
    }
    return {
      instagramBusinessAccountId: igAccount.id,
      instagramUsername: igAccount.username,
      pageAccessToken: page.accessToken,
      pageId: page.userId,
      pageName: page.displayName,
    };
  } catch {
    return null;
  }
}

async function fetchInstagramLinkedAccounts(userAccessToken: string): Promise<InstagramLinkedAccountSelection[]> {
  const pages = await fetchFacebookPages(userAccessToken);
  if (pages.length === 0) {
    const hint = await fetchFacebookPermissionsHint(userAccessToken);
    throw new Error(`No Facebook Pages were returned from the Graph API. ${hint}`);
  }

  const resolved = await Promise.all(pages.map((page) => fetchInstagramBusinessAccountForPage(page, userAccessToken)));
  const unique = new Map<string, InstagramLinkedAccountSelection>();
  for (const selection of resolved) {
    if (!selection || unique.has(selection.instagramBusinessAccountId)) {
      continue;
    }
    unique.set(selection.instagramBusinessAccountId, selection);
  }

  return [...unique.values()];
}

async function chooseInstagramAccount(
  prompt: AuthProviderContext["prompt"],
  accounts: InstagramLinkedAccountSelection[],
  userAccessToken: string,
): Promise<InstagramLinkedAccountSelection> {
  if (accounts.length === 0) {
    const hint = await fetchFacebookPermissionsHint(userAccessToken);
    throw new Error(`No Instagram business accounts were found for the Pages this token can access. ${hint}`);
  }

  if (accounts.length === 1 || !prompt.interactive) {
    return accounts[0];
  }

  const selected = await prompt.select(
    "Which Instagram account should SimplePost post to?",
    accounts.map((account) => {
      const pageLabel = account.pageName ?? account.pageId;
      const igLabel = account.instagramUsername ? `@${account.instagramUsername}` : account.instagramBusinessAccountId;
      return {
        description: account.pageId,
        label: `${pageLabel} — ${igLabel}`,
        value: account.instagramBusinessAccountId,
      };
    }),
    accounts[0].instagramBusinessAccountId,
  );

  return accounts.find((account) => account.instagramBusinessAccountId === selected) ?? accounts[0];
}

export class InstagramAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("instagram", {
      startAuthorization: startFacebookAuthorization,
      exchangeCode: exchangeFacebookCode,
      async completeLogin({ context, tokenSet }) {
        const userToken = tokenSet.accessToken;
        const linkedAccounts = await fetchInstagramLinkedAccounts(userToken);
        const selected = await chooseInstagramAccount(context.prompt, linkedAccounts, userToken);

        return {
          displayName: selected.instagramUsername ?? selected.pageName,
          secretPayload: {
            accessToken: selected.pageAccessToken,
            tokenMetadata: {
              graphApi: "facebook",
              pageId: selected.pageId,
            },
          },
          userId: selected.instagramBusinessAccountId,
          username: selected.instagramUsername,
        };
      },
    });
  }
}
