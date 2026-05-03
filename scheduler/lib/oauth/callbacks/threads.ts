import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const config = getPlatformOAuthConfig("threads")!;
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to exchange for long-lived Threads token");
    throw new Error("Failed to get long-lived Threads token");
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5_184_000, // 60 days default
  };
}

async function fetchThreadsProfile(accessToken: string) {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to fetch Threads profile");
    throw new Error("Failed to fetch Threads profile");
  }

  return response.json();
}

export async function handleThreadsCallback(ctx: CallbackContext): Promise<NextResponse> {
  const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } = await exchangeForLongLivedToken(
    ctx.accessToken,
  );

  let profile: { id?: string; username?: string; name?: string; threads_profile_picture_url?: string };
  try {
    profile = await fetchThreadsProfile(longLivedToken);
  } catch (profileError) {
    if (ctx.tokenData.user_id != null) {
      authLogger.info({ userId: ctx.tokenData.user_id }, "Threads /me failed, using user_id from token");
      profile = { id: String(ctx.tokenData.user_id) };
    } else {
      throw profileError;
    }
  }

  const platformAccountId = profile.id || String(ctx.tokenData.user_id ?? "");
  const username = profile.username || null;
  const displayName = profile.name || profile.username || null;
  const profilePicture = profile.threads_profile_picture_url || null;

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: "threads",
    platformAccountId,
    accessToken: longLivedToken,
    refreshToken: null,
    expiresAt: new Date(Date.now() + longLivedExpiresIn * 1000),
    scope: ctx.scope ?? null,
    username,
    displayName,
    email: null,
    profilePicture,
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts?success=true&platform=threads`);
}
