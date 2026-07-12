import crypto from "node:crypto";

import { fetchJson, resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";

interface MastodonProfile {
  id: string;
  username: string;
  acct: string;
  display_name?: string;
}

export interface MastodonLoginFlags {
  alias?: string;
  accessToken?: string;
  instanceUrl?: string;
}

function normalizeInstanceUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Mastodon instance URL must use HTTPS.");
  }
  return url.origin;
}

export class MastodonAuthProvider implements AuthProvider<MastodonLoginFlags> {
  public readonly platform = "mastodon" as AccountPlatform;

  public async login(flags: MastodonLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const { config, prompt, secretStore } = context;
    const rawInstance =
      flags.instanceUrl?.trim() ||
      (prompt.interactive ? await prompt.text("Mastodon instance URL", { required: true }) : undefined);
    const accessToken =
      flags.accessToken?.trim() || (prompt.interactive ? await prompt.secret("Mastodon user access token") : undefined);
    if (!rawInstance || !accessToken) {
      throw new Error("Instance URL and access token are required. Use --instance-url and --access-token.");
    }
    const instanceUrl = normalizeInstanceUrl(rawInstance);
    const profile = await fetchJson<MastodonProfile>(
      `${instanceUrl}/api/v1/accounts/verify_credentials`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
      "Mastodon credential validation",
    );
    if (!profile.id || !profile.username) throw new Error("Mastodon did not return an account profile.");

    const accountKey = `${profile.id}@${new URL(instanceUrl).host}`;
    const alias = await resolveStoredAccountAlias(
      prompt,
      config.mastodon.accounts,
      this.platform,
      accountKey,
      profile.acct || profile.username,
      flags.alias,
    );
    const existing = config.mastodon.accounts.find((account) => account.userId === accountKey);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `mastodon-account-${crypto.randomUUID()}`;
    const accounts = config.mastodon.accounts.filter((account) => account.userId !== accountKey);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: profile.display_name || profile.username,
      secretRef,
      updatedAt: now,
      userId: accountKey,
      username: `${profile.username}@${new URL(instanceUrl).host}`,
    });
    accounts.sort((left, right) => left.alias.localeCompare(right.alias));

    const secretPayload: OAuthAccountSecretPayload = {
      accessToken,
      tokenMetadata: { instanceUrl },
    };
    await secretStore.write(secretRef, secretPayload);
    prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}".`);

    return { ...config, mastodon: { accounts } };
  }
}
