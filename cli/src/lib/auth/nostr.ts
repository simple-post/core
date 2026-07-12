import crypto from "node:crypto";

import { getNostrPublicKey } from "@simple-post/sdk";

import { resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";

export interface NostrLoginFlags {
  alias?: string;
  privateKey?: string;
  relays?: string;
}

function parseRelays(value: string): string[] {
  const relays = value
    .split(",")
    .map((relay) => relay.trim())
    .filter(Boolean);
  if (relays.length === 0 || relays.some((relay) => !/^wss:\/\//i.test(relay))) {
    throw new Error("Provide at least one comma-separated wss:// Nostr relay URL.");
  }
  return [...new Set(relays)];
}

export class NostrAuthProvider implements AuthProvider<NostrLoginFlags> {
  public readonly platform = "nostr" as AccountPlatform;
  public async login(flags: NostrLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const privateKey =
      flags.privateKey?.trim() ||
      (context.prompt.interactive ? await context.prompt.secret("Nostr private key (nsec or hex)") : undefined);
    const relayInput =
      flags.relays?.trim() ||
      (context.prompt.interactive
        ? await context.prompt.text("Relay URLs (comma-separated wss:// URLs)", { required: true })
        : undefined);
    if (!privateKey || !relayInput)
      throw new Error(
        "Nostr private key and relays are required. Use --private-key and --relays in non-interactive mode.",
      );
    const publicKey = getNostrPublicKey(privateKey);
    const relays = parseRelays(relayInput);
    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config.nostr.accounts,
      this.platform,
      publicKey,
      `nostr-${publicKey.slice(0, 8)}`,
      flags.alias,
    );
    const existing = context.config.nostr.accounts.find((account) => account.userId === publicKey);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `nostr-account-${crypto.randomUUID()}`;
    const accounts = context.config.nostr.accounts.filter((account) => account.userId !== publicKey);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: `npub ${publicKey.slice(0, 12)}…`,
      secretRef,
      updatedAt: now,
      userId: publicKey,
      settings: { relays },
    });
    accounts.sort((left, right) => left.alias.localeCompare(right.alias));
    const secret: OAuthAccountSecretPayload = { accessToken: privateKey };
    await context.secretStore.write(secretRef, secret);
    context.prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}".`);
    return { ...context.config, nostr: { accounts } };
  }
}
