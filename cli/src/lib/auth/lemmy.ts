import crypto from "node:crypto";

import { fetchJson, resolveStoredAccountAlias } from "./oauth.js";

import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";
export interface LemmyLoginFlags {
  alias?: string;
  instanceUrl?: string;
  username?: string;
  password?: string;
  communityId?: number;
  apiVersion?: string;
}
export class LemmyAuthProvider implements AuthProvider<LemmyLoginFlags> {
  public readonly platform = "lemmy" as AccountPlatform;
  public async login(flags: LemmyLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const instanceUrl = (
      flags.instanceUrl ||
      (context.prompt.interactive ? await context.prompt.text("Instance URL", { required: true }) : "")
    ).replace(/\/$/, "");
    const username =
      flags.username || (context.prompt.interactive ? await context.prompt.text("Username", { required: true }) : "");
    const password = flags.password || (context.prompt.interactive ? await context.prompt.secret("Password") : "");
    const communityId =
      flags.communityId ??
      (context.prompt.interactive ? Number(await context.prompt.text("Default community ID", { required: true })) : 0);
    const apiVersion = flags.apiVersion === "v4" ? "v4" : "v3";
    if (!instanceUrl || !username || !password || !communityId)
      throw new Error("Instance URL, username, password, and community ID are required.");
    const path = apiVersion === "v4" ? "/api/v4/account/auth/login" : "/api/v3/user/login";
    const login = await fetchJson<{ jwt?: string }>(
      `${instanceUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_email: username, password }),
      },
      "Lemmy login",
    );
    if (!login.jwt) throw new Error("Lemmy login did not return a JWT.");
    const id = `${instanceUrl}#${username}`;
    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config.lemmy.accounts,
      this.platform,
      id,
      username,
      flags.alias,
    );
    const existing = context.config.lemmy.accounts.find((account) => account.userId === id);
    const now = new Date().toISOString();
    const secretRef = existing?.secretRef ?? `lemmy-account-${crypto.randomUUID()}`;
    const accounts = context.config.lemmy.accounts.filter((account) => account.userId !== id);
    accounts.push({
      alias,
      connectedAt: existing?.connectedAt ?? now,
      displayName: `${username}@${new URL(instanceUrl).host}`,
      username,
      userId: id,
      secretRef,
      settings: { instanceUrl, communityId, apiVersion },
      updatedAt: now,
    });
    const secret: OAuthAccountSecretPayload = { accessToken: login.jwt };
    await context.secretStore.write(secretRef, secret);
    context.prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}".`);
    return { ...context.config, lemmy: { accounts } };
  }
}
