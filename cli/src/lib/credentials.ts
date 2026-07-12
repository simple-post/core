import {
  getAccountPlatformConfig,
  getClientIdEnvVar,
  getClientSecretEnvVar,
  isAccountPlatform,
} from "./account/platforms.js";

import type { AccountPlatform } from "./account/platforms.js";
import type { SecretStore } from "./secrets.js";
import type { CliConfigV1, OAuthAccountSecretPayload, ResolvedStoredAccount } from "./types.js";
import type { Platform, Post, PostOptions } from "@simple-post/sdk";

export type AccountSelections = Partial<Record<Platform, string[]>>;

const YOUTUBE_TOKEN_BUFFER_SEC = 5 * 60;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOAuthAccountSecret(payload: unknown, platform: AccountPlatform): OAuthAccountSecretPayload {
  if (!isObject(payload) || typeof payload.accessToken !== "string") {
    throw new Error(`Stored ${getAccountPlatformConfig(platform).displayName} account secret is missing or malformed.`);
  }

  const tokenMetadata = isObject(payload.tokenMetadata) ? payload.tokenMetadata : undefined;
  return {
    accessToken: payload.accessToken,
    ...(typeof payload.refreshToken === "string" ? { refreshToken: payload.refreshToken } : {}),
    ...(typeof payload.expiresAt === "number" ? { expiresAt: payload.expiresAt } : {}),
    ...(tokenMetadata ? { tokenMetadata } : {}),
  };
}

function getStoredClientId(platform: AccountPlatform, secret: OAuthAccountSecretPayload): string {
  const stored = secret.tokenMetadata?.clientId;
  if (typeof stored === "string" && stored) {
    return stored;
  }

  const fromEnv = process.env[getClientIdEnvVar(platform)];
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    `The stored ${getAccountPlatformConfig(platform).displayName} account does not record its OAuth client ID. Set ${getClientIdEnvVar(platform)} or reconnect the account.`,
  );
}

function buildStoredAccountPostOptions(
  platform: AccountPlatform,
  metadata: ResolvedStoredAccount["metadata"],
  secret: OAuthAccountSecretPayload,
): PostOptions {
  switch (platform) {
    case "x": {
      if (!secret.refreshToken || typeof secret.expiresAt !== "number") {
        throw new Error(
          `Stored X account "${metadata.alias}" is missing refresh token details. Reconnect the account.`,
        );
      }

      return {
        x: {
          credentials: {
            accessToken: secret.accessToken,
            clientId: getStoredClientId("x", secret),
            expiresAt: secret.expiresAt,
            refreshToken: secret.refreshToken,
          },
        },
      };
    }
    case "youtube": {
      const nowSec = Math.floor(Date.now() / 1000);
      const clientSecret = process.env[getClientSecretEnvVar("youtube")];
      const accessTokenValid =
        typeof secret.expiresAt === "number" ? secret.expiresAt > nowSec + YOUTUBE_TOKEN_BUFFER_SEC : true;

      if (accessTokenValid) {
        return {
          youtube: {
            credentials: {
              accessToken: secret.accessToken,
            },
          },
        };
      }

      if (secret.refreshToken && clientSecret) {
        return {
          youtube: {
            credentials: {
              clientId: getStoredClientId("youtube", secret),
              clientSecret,
              refreshToken: secret.refreshToken,
            },
          },
        };
      }

      return {
        youtube: {
          credentials: {
            accessToken: secret.accessToken,
          },
        },
      };
    }
    case "facebook": {
      return {
        facebook: {
          credentials: {
            pageAccessToken: secret.accessToken,
            pageId: metadata.userId,
          },
        },
      };
    }
    case "instagram": {
      const graphApi =
        secret.tokenMetadata?.graphApi === "facebook" || secret.tokenMetadata?.graphApi === "instagram"
          ? secret.tokenMetadata.graphApi
          : undefined;
      return {
        instagram: {
          credentials: {
            accessToken: secret.accessToken,
            businessAccountId: metadata.userId,
            ...(graphApi ? { graphApi } : {}),
            ...(typeof secret.expiresAt === "number" ? { expiresAt: secret.expiresAt } : {}),
          },
        },
      };
    }
    case "tiktok": {
      return {
        tiktok: {
          credentials: {
            accessToken: secret.accessToken,
          },
        },
      };
    }
    case "bluesky": {
      const tokenMetadata = secret.tokenMetadata ?? {};
      const pdsUrl = typeof tokenMetadata.pdsUrl === "string" ? tokenMetadata.pdsUrl : undefined;
      if (!pdsUrl) {
        throw new Error(`Stored Bluesky account "${metadata.alias}" is missing its PDS URL. Reconnect the account.`);
      }

      return {
        bluesky: {
          credentials: {
            accessToken: secret.accessToken,
            clientId: getStoredClientId("bluesky", secret),
            did: metadata.userId,
            ...(typeof tokenMetadata.dpopPrivateJwk === "object" && tokenMetadata.dpopPrivateJwk
              ? { dpopPrivateJwk: tokenMetadata.dpopPrivateJwk as Record<string, unknown> }
              : {}),
            ...(typeof tokenMetadata.dpopPublicJwk === "object" && tokenMetadata.dpopPublicJwk
              ? { dpopPublicJwk: tokenMetadata.dpopPublicJwk as Record<string, unknown> }
              : {}),
            ...(typeof secret.expiresAt === "number" ? { expiresAt: secret.expiresAt } : {}),
            pdsUrl,
            ...(secret.refreshToken ? { refreshToken: secret.refreshToken } : {}),
            ...(typeof tokenMetadata.tokenUrl === "string" ? { tokenUrl: tokenMetadata.tokenUrl } : {}),
          },
        },
      };
    }
    case "threads": {
      return {
        threads: {
          credentials: {
            accessToken: secret.accessToken,
            userId: metadata.userId,
          },
        },
      };
    }
    case "linkedin": {
      return {
        linkedin: {
          credentials: {
            accessToken: secret.accessToken,
            memberId: metadata.userId,
          },
        },
      };
    }
    case "pinterest": {
      return {
        pinterest: {
          boardId: (metadata.settings?.boardId as string) ?? "",
          credentials: {
            accessToken: secret.accessToken,
          },
        },
      };
    }
    case "mastodon": {
      const instanceUrl = secret.tokenMetadata?.instanceUrl;
      if (typeof instanceUrl !== "string" || !instanceUrl) {
        throw new Error(`Stored Mastodon account "${metadata.alias}" is missing its instance URL. Reconnect it.`);
      }
      return {
        mastodon: {
          credentials: { accessToken: secret.accessToken, instanceUrl },
        },
      };
    }
    case "telegram": {
      return {
        telegram: {
          chatId: metadata.userId,
          credentials: {
            botToken: secret.accessToken,
          },
        },
      };
    }
  }

  throw new Error(`Stored account resolution is not implemented for ${platform}.`);
}

export function parseAccountSelections(rawValues?: string[]): AccountSelections {
  const selections: AccountSelections = {};
  for (const raw of rawValues ?? []) {
    const [platformPart, ...aliasParts] = raw.split(":");
    const alias = aliasParts.join(":").trim();
    if (!platformPart || !alias) {
      throw new Error(`Invalid --account value "${raw}". Expected <platform>:<alias>.`);
    }

    const normalizedPlatform = platformPart.trim();
    if (!isAccountPlatform(normalizedPlatform)) {
      throw new Error(`Stored accounts are not supported for platform "${normalizedPlatform}".`);
    }

    const platform = normalizedPlatform as Platform;
    const aliases = selections[platform] ?? [];
    if (aliases.includes(alias)) {
      throw new Error(`Duplicate --account selection "${raw}".`);
    }

    selections[platform] = [...aliases, alias];
  }

  return selections;
}

export class CredentialResolver {
  public constructor(
    private readonly cliConfig: CliConfigV1,
    private readonly secretStore: SecretStore,
  ) {}

  public async resolveAccount(platform: Platform, alias: string): Promise<ResolvedStoredAccount> {
    if (!isAccountPlatform(platform)) {
      throw new Error(`Stored account resolution is not implemented for ${platform}.`);
    }

    const account = this.cliConfig[platform].accounts.find((candidate) => candidate.alias === alias);
    if (!account) {
      throw new Error(
        `No stored ${getAccountPlatformConfig(platform).displayName} account named "${alias}" was found. Run "simplepost account ${platform}" to inspect accounts.`,
      );
    }

    const accountSecret = parseOAuthAccountSecret(await this.secretStore.read(account.secretRef), platform);
    return {
      alias: account.alias,
      metadata: account,
      platform,
      postOptions: buildStoredAccountPostOptions(platform, account, accountSecret),
      secretRef: account.secretRef,
    };
  }

  public injectResolvedAccount(post: Post, account: ResolvedStoredAccount): Post {
    if (!post.platforms.includes(account.platform)) {
      throw new Error(
        `Received --account ${account.platform}:${account.alias}, but the post does not target platform "${account.platform}".`,
      );
    }

    const options: PostOptions = {
      ...(post.options ? structuredClone(post.options) : {}),
    };

    const nextPlatformOptions = account.postOptions[account.platform];
    if (nextPlatformOptions) {
      const existingPlatformOptions = options[account.platform] ?? {};
      (options as Record<string, unknown>)[account.platform] = {
        ...nextPlatformOptions,
        ...existingPlatformOptions,
        ...("credentials" in nextPlatformOptions ? { credentials: nextPlatformOptions.credentials } : {}),
      };
    }

    return {
      ...post,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  }
}
