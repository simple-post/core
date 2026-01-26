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
  }),
  twitter: (account: ConnectedAccount) => credentialBuilders.x(account),
  youtube: (account: ConnectedAccount) => {
    // Prefer accessToken if available, otherwise fall back to OAuth2 credentials
    if (account.accessToken) {
      return {
        accessToken: account.accessToken,
      };
    }
    return {
      clientId: process.env.YOUTUBE_CLIENT_ID || "",
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
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
  }),
  tiktok: (account: ConnectedAccount) => ({
    accessToken: account.accessToken,
  }),
  bluesky: (account: ConnectedAccount) => {
    const metadata = getTokenMetadata(account);
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken || "",
      did: account.platformAccountId,
      pdsUrl: (metadata.pdsUrl as string) || process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social",
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
};

/**
 * Builds credentials for a connected account
 */
export function buildCredentials(account: ConnectedAccount): Credentials {
  const platform = account.platform.toLowerCase();
  const builder = credentialBuilders[platform];
  return builder ? builder(account) : {};
}

/**
 * Platform-specific post option builders
 */
const postOptionBuilders: Record<
  string,
  (account: ConnectedAccount, credentials: Credentials, accountSpecificOptions: unknown) => PostOptions
> = {
  x: (account, credentials, accountSpecificOptions) => ({
    x: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"x">,
    },
  }),
  twitter: (account, credentials, accountSpecificOptions) =>
    postOptionBuilders.x(account, credentials, accountSpecificOptions),
  youtube: (account, credentials, accountSpecificOptions) => {
    // Ensure credentials match the expected YouTube credentials type
    const youtubeCredentials = account.accessToken
      ? { accessToken: account.accessToken }
      : {
          clientId: process.env.YOUTUBE_CLIENT_ID || "",
          clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
          refreshToken: account.refreshToken || "",
        };

    return {
      youtube: {
        ...(accountSpecificOptions as Record<string, unknown>),
        credentials: youtubeCredentials as PlatformCredentials<"youtube">,
      },
    };
  },
  telegram: (account, credentials, accountSpecificOptions) => ({
    telegram: {
      chatId: account.platformAccountId,
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"telegram">,
    },
  }),
  facebook: (account, credentials, accountSpecificOptions) => ({
    facebook: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"facebook">,
    },
  }),
  instagram: (account, credentials, accountSpecificOptions) => ({
    instagram: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"instagram">,
    },
  }),
  tiktok: (account, credentials, accountSpecificOptions) => ({
    tiktok: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"tiktok">,
    },
  }),
  bluesky: (account, credentials, accountSpecificOptions) => ({
    bluesky: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"bluesky">,
    },
  }),
  threads: (account, credentials, accountSpecificOptions) => ({
    threads: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"threads">,
    },
  }),
  linkedin: (account, credentials, accountSpecificOptions) => ({
    linkedin: {
      ...(accountSpecificOptions as Record<string, unknown>),
      credentials: credentials as PlatformCredentials<"linkedin">,
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
  const builder = postOptionBuilders[platform];

  if (!builder) {
    return {};
  }

  return builder(account, credentials, accountSpecificOptions) as PostOptions;
}
