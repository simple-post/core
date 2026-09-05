import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import { readMetaError } from "@/lib/oauth/meta-error";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

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

async function fetchInstagramProfile(accessToken: string) {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username,name,profile_picture_url,account_type");
  const headers = { Authorization: `Bearer ${accessToken}` };
  let response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const providerError = await readMetaError(response);
    // Optional profile fields must not prevent connecting an otherwise valid
    // publishing account. Retry only Meta's invalid-field/parameter response.
    if (response.status === 400 && providerError?.code === 100) {
      url.searchParams.set("fields", "user_id,username");
      response = await fetch(url.toString(), { headers });
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

  return response.json();
}

export async function handleInstagramCallback(ctx: CallbackContext): Promise<NextResponse> {
  const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } = await exchangeForLongLivedToken(
    ctx.accessToken,
  );
  const profile = await fetchInstagramProfile(longLivedToken);
  const platformAccountId = profile.user_id ?? profile.id;
  if (!platformAccountId)
    throw new OAuthCallbackError("profile_fetch_failed", "Instagram did not return an account ID");

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: "instagram",
    platformAccountId: String(platformAccountId),
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
