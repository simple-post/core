import { getBlueskyClientId } from "@/lib/oauth/bluesky-client";
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
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    accessToken: account.accessToken,
    refreshToken: account.refreshToken || "",
    expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0,
    // Numeric X user id captured at connect time. Lets repost skip the
    // rate-limited users/me lookup.
    userId: account.platformAccountId || undefined,
  }),
  twitter: (account: ConnectedAccount) => credentialBuilders.x(account),
  youtube: (account: ConnectedAccount) => {
    // Use same client as connect flow - refresh tokens are tied to the OAuth client.
    // YOUTUBE_* overrides GOOGLE_* when set (for separate YouTube app).
    const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

    // Use access token when still valid - avoids hitting refresh endpoint (which can fail with
    // invalid_grant if token was revoked or credentials mismatch). Buffer: 5 min before expiry.
    const YOUTUBE_TOKEN_BUFFER_SEC = 5 * 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAtSec = account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0;
    const accessTokenValid = account.accessToken && expiresAtSec > nowSec + YOUTUBE_TOKEN_BUFFER_SEC;

    if (accessTokenValid) {
      return { accessToken: account.accessToken };
    }
    if (account.refreshToken && clientId && clientSecret) {
      return {
        clientId,
        clientSecret,
        refreshToken: account.refreshToken,
      };
    }
    if (account.accessToken) {
      return { accessToken: account.accessToken };
    }
    return {
      clientId,
      clientSecret,
      refreshToken: account.refreshToken || "",
    };
  },
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
    expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : undefined,
  }),
  tiktok: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
  }),
  bluesky: (account: ConnectedAccount) => {
    const metadata = getTokenMetadata(account);
    const issuer = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";
    const tokenUrl =
      typeof metadata.tokenUrl === "string" && metadata.tokenUrl ? metadata.tokenUrl : `${issuer}/oauth/token`;
    const clientId =
      typeof metadata.clientId === "string" && metadata.clientId ? metadata.clientId : getBlueskyClientId();
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken || "",
      expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0,
      did: account.platformAccountId,
      pdsUrl: (metadata.pdsUrl as string) || issuer,
      tokenUrl,
      clientId,
      dpopPublicJwk: metadata.dpopPublicJwk,
      dpopPrivateJwk: metadata.dpopPrivateJwk,
    };
  },
  threads: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
    userId: account.platformAccountId,
    expiresAt: account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : undefined,
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
