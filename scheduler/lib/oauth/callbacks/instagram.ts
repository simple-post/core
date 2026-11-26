import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import { readMetaError } from "@/lib/oauth/meta-error";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const config = getPlatformOAuthConfig("instagram")!;
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    authLogger.error(
      { platform: "instagram", status: response.status, providerError: await readMetaError(response) },
      "Failed to exchange for long-lived Instagram token",
    );
    throw new OAuthCallbackError("token_exchange_failed", "Failed to get long-lived Instagram token");
  }

  const data = await response.json();
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new OAuthCallbackError("no_access_token", "Instagram did not return a long-lived access token");
  }
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5_184_000,
  };
}

type InstagramProfile = {
  id?: string;
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
};

async function fetchInstagramProfile(accessToken: string): Promise<InstagramProfile> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "id,user_id,username,name,profile_picture_url,account_type");
  const headers = { Authorization: `Bearer ${accessToken}` };
  let response = await fetch(url.toString(), { headers, redirect: "error", signal: AbortSignal.timeout(8000) });

  if (!response.ok) {
    const providerError = await readMetaError(response);
    // Optional profile fields must not prevent connecting an otherwise valid
    // publishing account. Retry only Meta's invalid-field/parameter response.
    if (response.status === 400 && providerError?.code === 100) {
      url.searchParams.set("fields", "id,user_id,username");
      response = await fetch(url.toString(), { headers, redirect: "error", signal: AbortSignal.timeout(8000) });
    } else {
      authLogger.error(
        { platform: "instagram", status: response.status, providerError },
        "Failed to fetch Instagram profile",
      );
      throw new OAuthCallbackError("profile_fetch_failed", "Failed to fetch Instagram profile");
    }
  }
  if (!response.ok) {
    authLogger.error(
      { platform: "instagram", status: response.status, providerError: await readMetaError(response) },
      "Failed to fetch Instagram profile",
    );
    throw new OAuthCallbackError("profile_fetch_failed", "Failed to fetch Instagram profile");
  }

  // Meta IDs can exceed JavaScript's safe integer range. Preserve the
  // original digits when Graph encodes an identifier as a JSON number.
  return JSON.parse(await response.text(), (key, value: unknown, context?: { source?: string }) =>
    (key === "id" || key === "user_id") && typeof value === "number" ? context?.source : value,
  );
}

function profileIds(profile: InstagramProfile) {
  return [profile.user_id, profile.id].filter((id): id is string => typeof id === "string" && /^\d+$/u.test(id));
}

export async function handleInstagramCallback(ctx: CallbackContext): Promise<NextResponse> {
  const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } = await exchangeForLongLivedToken(
    ctx.accessToken,
  );
  const profile = await fetchInstagramProfile(longLivedToken);
  const grantedIds = profileIds(profile);
  let [platformAccountId] = grantedIds;
  if (!platformAccountId)
    throw new OAuthCallbackError("profile_fetch_failed", "Instagram did not return an account ID");

  let previousIdentity: { platformAccountId: string; updatedAt: Date } | undefined;
  if (ctx.reconnectAccountId) {
    const stored = await prisma.connectedAccount.findFirst({
      where: {
        id: ctx.reconnectAccountId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
        platform: "instagram",
      },
    });
    if (!stored) throw new OAuthCallbackError("reconnect_account_mismatch", "Choose the same account to reconnect.");
    if (grantedIds.includes(stored.platformAccountId)) {
      // Either Graph ID can be returned by Instagram. Keep the identity
      // already used by the connection and its publishing history.
      platformAccountId = stored.platformAccountId;
    } else {
      // Older grants may expose a different identifier. Require both tokens
      // to identify the same profile before changing a stored identity.
      const previousProfile = await Promise.resolve()
        .then(() => fetchInstagramProfile(decryptConnectedAccountSecrets(stored).accessToken))
        .catch(() => null);
      if (!previousProfile || !profileIds(previousProfile).some((id) => grantedIds.includes(id)))
        throw new OAuthCallbackError("reconnect_account_mismatch", "Choose the same account to reconnect.");
      previousIdentity = { platformAccountId: stored.platformAccountId, updatedAt: stored.updatedAt };
    }
  }
  if (ctx.inboxIdentity) {
    if (!grantedIds.includes(ctx.inboxIdentity))
      return NextResponse.redirect(`${ctx.baseURL}/inbox?connection=account`);
    if (!ctx.reconnectAccountId) platformAccountId = ctx.inboxIdentity;
  }
  await upsertConnectedAccount({
    userId: ctx.userId,
    ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
    ...(ctx.reconnectAccountId && { reconnectAccountId: ctx.reconnectAccountId }),
    platform: "instagram",
    platformAccountId,
    ...(previousIdentity && { previousIdentity }),
    accessToken: longLivedToken,
    refreshToken: null,
    expiresAt: new Date(Date.now() + longLivedExpiresIn * 1000),
    scope: ctx.scope ?? null,
    username: profile.username,
    displayName: profile.name || profile.username,
    email: null,
    profilePicture: profile.profile_picture_url || null,
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts?success=true&platform=instagram`);
}
