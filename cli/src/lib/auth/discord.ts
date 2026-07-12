import crypto from "node:crypto";

import { fetchJson, resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";

interface DiscordWebhook {
  id?: string;
  name?: string | null;
  channel_id?: string | null;
  guild_id?: string | null;
}
export interface DiscordLoginFlags {
  alias?: string;
  webhookUrl?: string;
}

function normalizeWebhookUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["discord.com", "www.discord.com"].includes(url.hostname) ||
    !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
  ) {
    throw new Error("Provide a valid https://discord.com/api/webhooks/... incoming webhook URL.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class DiscordAuthProvider implements AuthProvider<DiscordLoginFlags> {
  public readonly platform = "discord" as AccountPlatform;
  public async login(flags: DiscordLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const raw =
      flags.webhookUrl?.trim() ||
      (context.prompt.interactive ? await context.prompt.secret("Discord webhook URL") : undefined);
    if (!raw) throw new Error("Discord webhook URL is required. Use --webhook-url in non-interactive mode.");
    const webhookUrl = normalizeWebhookUrl(raw);
    const webhook = await fetchJson<DiscordWebhook>(webhookUrl, { method: "GET" }, "Discord webhook validation");
    if (!webhook.id) throw new Error("Discord did not return a webhook ID.");
    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config.discord.accounts,
      this.platform,
      webhook.id,
      webhook.name || `discord-${webhook.id}`,
      flags.alias,
    );
    const existing = context.config.discord.accounts.find((account) => account.userId === webhook.id);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `discord-account-${crypto.randomUUID()}`;
    const accounts = context.config.discord.accounts.filter((account) => account.userId !== webhook.id);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: webhook.name || "Discord webhook",
      secretRef,
      updatedAt: now,
      userId: webhook.id,
      settings: { channelId: webhook.channel_id, guildId: webhook.guild_id },
    });
    accounts.sort((left, right) => left.alias.localeCompare(right.alias));
    const secretPayload: OAuthAccountSecretPayload = { accessToken: webhookUrl };
    await context.secretStore.write(secretRef, secretPayload);
    context.prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} webhook "${alias}".`);
    return { ...context.config, discord: { accounts } };
  }
}
