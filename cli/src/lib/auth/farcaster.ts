import crypto from "node:crypto";

import { resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";
export interface FarcasterLoginFlags {
  alias?: string;
  fid?: number;
  signerPrivateKey?: string;
  hubUrl?: string;
  username?: string;
}
export class FarcasterAuthProvider implements AuthProvider<FarcasterLoginFlags> {
  public readonly platform = "farcaster" as AccountPlatform;
  public async login(flags: FarcasterLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const fid =
      flags.fid ??
      (context.prompt.interactive ? Number(await context.prompt.text("FID", { required: true })) : undefined);
    const key =
      flags.signerPrivateKey?.trim() ||
      (context.prompt.interactive ? await context.prompt.secret("Authorized signer private key") : undefined);
    const hubUrl =
      flags.hubUrl?.trim() ||
      (context.prompt.interactive
        ? await context.prompt.text("Snapchain gRPC endpoint", { required: true })
        : undefined);
    const username =
      flags.username?.trim() ||
      (context.prompt.interactive ? (await context.prompt.text("Username (optional)")).trim() : undefined);
    if (!fid || !Number.isInteger(fid) || !key || !/^(0x)?[a-fA-F0-9]{64}$/.test(key) || !hubUrl)
      throw new Error("A positive FID, 32-byte hex signer key, and Snapchain endpoint are required.");
    const id = String(fid);
    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config.farcaster.accounts,
      this.platform,
      id,
      username || `fid-${fid}`,
      flags.alias,
    );
    const existing = context.config.farcaster.accounts.find((account) => account.userId === id);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `farcaster-account-${crypto.randomUUID()}`;
    const accounts = context.config.farcaster.accounts.filter((account) => account.userId !== id);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: username ? `@${username}` : `FID ${fid}`,
      ...(username ? { username } : {}),
      secretRef,
      settings: { hubUrl },
      updatedAt: now,
      userId: id,
    });
    accounts.sort((a, b) => a.alias.localeCompare(b.alias));
    const secret: OAuthAccountSecretPayload = { accessToken: key };
    await context.secretStore.write(secretRef, secret);
    context.prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}".`);
    return { ...context.config, farcaster: { accounts } };
  }
}
