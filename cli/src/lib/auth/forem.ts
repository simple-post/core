import crypto from "node:crypto";

import { fetchJson, resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";
interface ForemUser {
  id?: number;
  username?: string;
  name?: string;
  profile_image?: string;
}
export interface ForemLoginFlags {
  alias?: string;
  instanceUrl?: string;
  apiKey?: string;
}
export class ForemAuthProvider implements AuthProvider<ForemLoginFlags> {
  public readonly platform = "forem" as AccountPlatform;
  public async login(flags: ForemLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const instanceUrl = (
      flags.instanceUrl?.trim() ||
      (context.prompt.interactive
        ? (await context.prompt.text("Instance URL", { defaultValue: "https://dev.to", required: true })).trim()
        : "https://dev.to")
    ).replace(/\/$/, "");
    const apiKey =
      flags.apiKey?.trim() || (context.prompt.interactive ? await context.prompt.secret("Forem API key") : "");
    if (!apiKey) throw new Error("Forem API key is required. Use --api-key in non-interactive mode.");
    const user = await fetchJson<ForemUser>(
      `${instanceUrl}/api/users/me`,
      { method: "GET", headers: { "api-key": apiKey, Accept: "application/vnd.forem.api-v1+json" } },
      "Forem API key validation",
    );
    if (!user.id || !user.username) throw new Error("Forem did not return an authenticated user.");
    const id = `${instanceUrl}#${user.id}`;
    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config.forem.accounts,
      this.platform,
      id,
      user.username,
      flags.alias,
    );
    const existing = context.config.forem.accounts.find((account) => account.userId === id);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `forem-account-${crypto.randomUUID()}`;
    const accounts = context.config.forem.accounts.filter((account) => account.userId !== id);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: user.name || user.username,
      username: user.username,
      userId: id,
      secretRef,
      settings: { instanceUrl },
      updatedAt: now,
    });
    const secret: OAuthAccountSecretPayload = { accessToken: apiKey };
    await context.secretStore.write(secretRef, secret);
    context.prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}".`);
    return { ...context.config, forem: { accounts } };
  }
}
