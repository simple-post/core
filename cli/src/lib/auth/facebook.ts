import crypto from "node:crypto";

import { OAuthAccountProvider, buildAuthorizationUrl, fetchJson, generatePkcePair } from "./oauth.js";

import type { OAuthAuthorizationSession, OAuthTokenSet, ResolvedOAuthAppConfig } from "./oauth.js";
import type { AuthProviderContext, OAuthLoginFlags } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";

interface FacebookPageRow {
  access_token?: string;
  id?: string;
  name?: string;
}

interface FacebookPagedResponse<T> {
  data?: T[];
  paging?: { next?: string };
}

export interface FacebookPageSelection {
  accessToken: string;
  displayName?: string;
  userId: string;
}

/**
 * Facebook OIDC authorization code + PKCE (see Meta docs: "OIDC Token with Manual Flow").
 * For Native/Desktop apps, client_secret must not be used here; send code_verifier instead.
 */
export async function exchangeFacebookCode(input: {
  appConfig: ResolvedOAuthAppConfig;
  code: string;
  codeVerifier?: string;
  platform: AccountPlatform;
}): Promise<OAuthTokenSet> {
  if (!input.codeVerifier?.trim()) {
    throw new Error(
      "Facebook Login is configured for OIDC + PKCE. Missing code verifier — ensure pkce is enabled for Facebook.",
    );
  }

  const url = new URL(input.appConfig.tokenUrl);
  url.searchParams.set("client_id", input.appConfig.clientId);
  url.searchParams.set("redirect_uri", input.appConfig.redirectUri);
  url.searchParams.set("code", input.code);
  url.searchParams.set("code_verifier", input.codeVerifier);

  const response = await fetchJson<Record<string, unknown>>(
    url.toString(),
    { method: "GET" },
    "Facebook token exchange",
  );

  const accessToken = typeof response.access_token === "string" ? response.access_token : undefined;
  if (!accessToken) {
    throw new Error("Facebook token exchange did not return an access token.");
  }

  const expiresIn = typeof response.expires_in === "number" ? response.expires_in : undefined;
  return {
    accessToken,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    raw: response,
  };
}

export function graphUrlWithAccessToken(pathAndQuery: string, accessToken: string): string {
  const base = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `https://graph.facebook.com/v25.0/${pathAndQuery.replace(/^\//, "")}`;
  const url = new URL(base);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

export async function fetchFacebookPermissionsHint(accessToken: string): Promise<string> {
  try {
    interface PermRow {
      permission?: string;
      status?: string;
    }
    const r = await fetchJson<{ data?: PermRow[] }>(
      graphUrlWithAccessToken("me/permissions", accessToken),
      { method: "GET" },
      "Facebook permissions lookup",
    );
    const granted = new Set(
      (r.data ?? [])
        .filter((p) => p.status === "granted" && typeof p.permission === "string")
        .map((p) => p.permission as string),
    );
    const want = ["pages_show_list", "pages_manage_posts", "business_management"] as const;
    const missing = want.filter((p) => !granted.has(p));
    const grantedList = [...granted].sort().join(", ") || "(none)";

    if (missing.length > 0) {
      return `This token is missing: ${missing.join(", ")}. Granted permissions: ${grantedList}. Disconnect and run login again; accept every permission and, if Facebook shows a Page picker, select the Page(s) to share with the app.`;
    }

    return `Permissions look granted (${grantedList}), but no Pages were found via /me/accounts, /me/assigned_pages, or your Businesses’ owned_pages / client_pages. In the login dialog, pick your Page in the granular Page picker; for Business Manager, the Page may be a client asset (not owned). Add the app in Business Settings → Integrations if required. Debug the token at developers.facebook.com/tools/debug/accesstoken.`;
  } catch {
    return "Could not read /me/permissions. Paste your user access token into Meta’s Access Token Debugger and confirm pages_show_list, pages_manage_posts, and business_management are granted.";
  }
}

function rowsToPageSelections(rows: FacebookPageRow[]): FacebookPageSelection[] {
  return rows.flatMap((page) => {
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

async function paginateGraphList<T>(firstUrl: string, label: string): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | undefined = firstUrl;

  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const response: FacebookPagedResponse<T> = await fetchJson<FacebookPagedResponse<T>>(
      currentUrl,
      { method: "GET" },
      label,
    );
    out.push(...(response.data ?? []));
    nextUrl = typeof response.paging?.next === "string" ? response.paging.next : undefined;
  }

  return out;
}

/**
 * Pages granted to the app on the user (standard Facebook Login).
 */
async function fetchFacebookPagesFromMeAccounts(accessToken: string): Promise<FacebookPageSelection[]> {
  const rows = await paginateGraphList<FacebookPageRow>(
    graphUrlWithAccessToken("me/accounts?fields=id,name,access_token&limit=100", accessToken),
    "Facebook pages lookup (me/accounts)",
  );
  return rowsToPageSelections(rows);
}

/**
 * When /me/accounts is empty, Pages are often only visible via Business Manager:
 * /me/businesses → {business-id}/owned_pages
 */
async function fetchPageAccessTokenFromUser(pageId: string, userAccessToken: string): Promise<string | undefined> {
  try {
    const r = await fetchJson<{ access_token?: string }>(
      graphUrlWithAccessToken(`${pageId}?fields=access_token`, userAccessToken),
      { method: "GET" },
      "Facebook page access_token lookup",
    );
    return typeof r.access_token === "string" ? r.access_token : undefined;
  } catch {
    return undefined;
  }
}

interface FacebookBusinessRow {
  id?: string;
  name?: string;
}

/**
 * Pages linked to Businesses you access: owned by the BM (`owned_pages`) or client/partner (`client_pages`).
 */
async function fetchFacebookPageRowsFromBusinessEdges(accessToken: string): Promise<FacebookPageRow[]> {
  let businesses: FacebookBusinessRow[];
  try {
    businesses = await paginateGraphList<FacebookBusinessRow>(
      graphUrlWithAccessToken("me/businesses?fields=id,name&limit=50", accessToken),
      "Facebook businesses lookup (me/businesses)",
    );
  } catch {
    return [];
  }

  const edges = ["owned_pages", "client_pages"] as const;
  const perBusiness = await Promise.all(
    businesses
      .filter((biz): biz is FacebookBusinessRow & { id: string } => typeof biz.id === "string" && biz.id.length > 0)
      .map(async (biz) => {
        const rowsNested = await Promise.all(
          edges.map(async (edge) => {
            try {
              return await paginateGraphList<FacebookPageRow>(
                graphUrlWithAccessToken(`${biz.id}/${edge}?fields=id,name,access_token&limit=100`, accessToken),
                `Facebook ${edge} (${biz.id})`,
              );
            } catch {
              return [] as FacebookPageRow[];
            }
          }),
        );
        return rowsNested.flat();
      }),
  );

  return perBusiness.flat();
}

async function addRowsToPageSelections(
  rows: FacebookPageRow[],
  userAccessToken: string,
  seen: Set<string>,
  out: FacebookPageSelection[],
): Promise<void> {
  const uniqueById = new Map<string, FacebookPageRow>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) {
      continue;
    }
    uniqueById.set(row.id, row);
  }
  if (uniqueById.size === 0) {
    return;
  }

  const resolved = await Promise.all(
    [...uniqueById.values()].map(async (row) => {
      const pageToken = row.access_token ?? (await fetchPageAccessTokenFromUser(row.id!, userAccessToken));
      return { row, pageToken };
    }),
  );

  for (const { row, pageToken } of resolved) {
    if (!row.id || !pageToken || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    out.push({
      accessToken: pageToken,
      displayName: row.name,
      userId: row.id,
    });
  }
}

export async function fetchFacebookPages(accessToken: string): Promise<FacebookPageSelection[]> {
  const fromAccounts = await fetchFacebookPagesFromMeAccounts(accessToken);
  if (fromAccounts.length > 0) {
    return fromAccounts;
  }

  const seen = new Set<string>();
  const merged: FacebookPageSelection[] = [];

  const [assignedRows, businessRows] = await Promise.all([
    paginateGraphList<FacebookPageRow>(
      graphUrlWithAccessToken("me/assigned_pages?fields=id,name,access_token&limit=100", accessToken),
      "Facebook assigned_pages lookup",
    ).catch(() => [] as FacebookPageRow[]),
    fetchFacebookPageRowsFromBusinessEdges(accessToken),
  ]);

  await addRowsToPageSelections(assignedRows, accessToken, seen, merged);
  await addRowsToPageSelections(businessRows, accessToken, seen, merged);

  return merged;
}

async function chooseFacebookPage(
  prompt: AuthProviderContext["prompt"],
  pages: FacebookPageSelection[],
  userAccessToken: string,
): Promise<FacebookPageSelection> {
  if (pages.length === 0) {
    const hint = await fetchFacebookPermissionsHint(userAccessToken);
    throw new Error(`No Facebook Pages were returned from the Graph API. ${hint}`);
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

export async function startFacebookAuthorization(input: {
  appConfig: ResolvedOAuthAppConfig;
  context: AuthProviderContext;
  flags: OAuthLoginFlags;
  platform: AccountPlatform;
}): Promise<OAuthAuthorizationSession> {
  void input.context;
  void input.flags;
  void input.platform;

  const pkcePair = await generatePkcePair();
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  return {
    appConfig: input.appConfig,
    authUrl: buildAuthorizationUrl({
      appConfig: input.appConfig,
      codeChallenge: pkcePair.codeChallenge,
      nonce,
      state,
    }),
    codeVerifier: pkcePair.codeVerifier,
    state,
  };
}

export class FacebookAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("facebook", {
      startAuthorization: startFacebookAuthorization,
      exchangeCode: exchangeFacebookCode,
      async completeLogin({ context, tokenSet }) {
        const userToken = tokenSet.accessToken;
        const selectedPage = await chooseFacebookPage(context.prompt, await fetchFacebookPages(userToken), userToken);
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
