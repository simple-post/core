import type { ConnectedAccount, AccountOptionsMap } from "@/types";

import type { PostOptions } from "@simple-post/sdk";

type Credentials = Record<string, unknown>;
type PlatformCredentials<K extends keyof PostOptions> =
  NonNullable<PostOptions[K]> extends {
    credentials?: infer C;
  }
    ? C
    : never;

const getTokenMetadata = (account: ConnectedAccount): Record<string, unknown> => {
  if (!account.tokenMetadata || typeof account.tokenMetadata !== "object") {
    return {};
  }
  return account.tokenMetadata as Record<string, unknown>;
};

/**
 * Platform-specific credential builders
 */
const credentialBuilders: Record<string, (account: ConnectedAccount) => Credentials> = {
  x: (account: ConnectedAccount) => ({
    // Refreshing is centralized in credential-health.ts under a PostgreSQL
    // advisory lock. Never let the SDK independently consume X's rotating
    // refresh token during a publish.
    accessToken: account.accessToken,
    expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0,
    // Numeric X user id captured at connect time. Lets repost skip the
    // rate-limited users/me lookup.
    userId: account.platformAccountId || undefined,
  }),
  twitter: (account: ConnectedAccount) => credentialBuilders.x(account),
  // The pre-publish credential health check owns YouTube refreshes. Supplying
  // only the access token prevents googleapis from refreshing outside the
  // cross-process account lock.
  youtube: (account: ConnectedAccount) => ({ accessToken: account.accessToken }),
  telegram: (account: ConnectedAccount) => ({
    botToken: account.accessToken || process.env.TELEGRAM_BOT_TOKEN || "",
  }),
  facebook: (account: ConnectedAccount) => ({
    pageAccessToken: account.accessToken,
    pageId: account.platformAccountId,
  }),
  instagram: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
    businessAccountId: account.platformAccountId,
  }),
  tiktok: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
  }),
  bluesky: (account: ConnectedAccount) => {
    const metadata = getTokenMetadata(account);
    const issuer = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";
    return {
      accessToken: account.accessToken,
      expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0,
      did: account.platformAccountId,
      pdsUrl: (metadata.pdsUrl as string) || issuer,
      // DPoP keys are still required to use the access token. The refresh
      // token/client details deliberately stay inside the locked scheduler
      // refresh path.
      dpopPublicJwk: metadata.dpopPublicJwk,
      dpopPrivateJwk: metadata.dpopPrivateJwk,
    };
  },
  threads: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
    userId: account.platformAccountId,
  }),
  linkedin: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
    memberId: account.platformAccountId,
  }),
  pinterest: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
  }),
  forem: (account: ConnectedAccount) => ({
    instanceUrl: String(getTokenMetadata(account).instanceUrl ?? "https://dev.to"),
    apiKey: account.accessToken,
  }),
  nostr: (account: ConnectedAccount) => ({ privateKey: account.accessToken }),
};

/**
 * Builds credentials for a connected account
 */
export function buildCredentials(account: ConnectedAccount): Credentials {
  const platform = account.platform.toLowerCase();
  const builder = credentialBuilders[platform];
  return builder ? builder(account) : {};
}

function defaultPostOptionBuilder(
  platform: string,
  _account: ConnectedAccount,
  credentials: Credentials,
  accountSpecificOptions: unknown,
): PostOptions {
  return {
    [platform]: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials,
    },
  } as PostOptions;
}

const postOptionOverrides: Record<
  string,
  (account: ConnectedAccount, credentials: Credentials, accountSpecificOptions: unknown) => PostOptions
> = {
  twitter: (account, credentials, accountSpecificOptions) =>
    defaultPostOptionBuilder("x", account, credentials, accountSpecificOptions),
  telegram: (account, credentials, accountSpecificOptions) => ({
    telegram: {
      chatId: account.platformAccountId,
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"telegram">,
    },
  }),
  pinterest: (account, credentials, accountSpecificOptions) => ({
    pinterest: {
      ...(accountSpecificOptions as Record<string, unknown>),
      boardId: (accountSpecificOptions as { boardId?: string }).boardId || process.env.PINTEREST_BOARD_ID || "",
      credentials: credentials as PlatformCredentials<"pinterest">,
    },
  }),
  nostr: (account, credentials, accountSpecificOptions) => {
    const metadata = getTokenMetadata(account);
    return {
      nostr: {
        ...(accountSpecificOptions as Record<string, unknown>),
        relays: Array.isArray(metadata.relays) ? metadata.relays : [],
        credentials: credentials as PlatformCredentials<"nostr">,
      },
    };
  },
};

/**
 * Merges account-specific options with credentials
 */
export function buildPostOptions(account: ConnectedAccount, accountOptions?: AccountOptionsMap): PostOptions {
  const platform = account.platform.toLowerCase();
  const credentials = buildCredentials(account);
  const accountSpecificOptions = accountOptions?.[account.id] || {};
  const override = postOptionOverrides[platform];
  if (override) {
    return override(account, credentials, accountSpecificOptions) as PostOptions;
  }

  return defaultPostOptionBuilder(platform, account, credentials, accountSpecificOptions);
}
