import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
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
    authLogger.error({ status: response.status }, "Failed to exchange for long-lived Instagram token");
    throw new Error("Failed to get long-lived Instagram token");
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5_184_000,
  };
}

async function fetchInstagramProfile(accessToken: string) {
  const response = await fetch(
    `https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${accessToken}`,
  );

  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to fetch Instagram profile");
    throw new Error("Failed to fetch Instagram profile");
  }

  return response.json();
}

export async function handleInstagramCallback(ctx: CallbackContext): Promise<NextResponse> {
  const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } = await exchangeForLongLivedToken(
    ctx.accessToken,
  );
  const profile = await fetchInstagramProfile(longLivedToken);

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: "instagram",
    platformAccountId: profile.user_id || profile.id,
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
