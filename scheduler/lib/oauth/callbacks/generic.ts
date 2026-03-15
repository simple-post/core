import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

async function fetchUserProfile(platform: string, accessToken: string) {
  const config = getPlatformOAuthConfig(platform)!;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  let response: Response;

  if (platform === "threads") {
    const url = new URL(config.userInfoUrl);
    url.searchParams.set("access_token", accessToken);
    response = await fetch(url.toString());
  } else {
    response = await fetch(config.userInfoUrl, { headers });
  }

  if (!response.ok) {
    authLogger.warn(
      { platform, status: response.status, statusText: response.statusText },
      "Failed to fetch user profile",
    );
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const data = await response.json();

  if (platform === "tiktok" && data.data?.user) {
    return data.data.user;
  }

  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external API responses from multiple platforms
function extractProfileData(platform: string, profile: any, tokenData: CallbackContext["tokenData"]) {
  let platformAccountId: string;
  let username: string | null = null;
  let displayName: string | null = null;
  let email: string | null = null;
  let profilePicture: string | null = null;

  switch (platform) {
    case "x": {
      platformAccountId = profile.data?.id || profile.id;
      username = profile.data?.username || profile.username;
      displayName = profile.data?.name || profile.name;
      profilePicture = profile.data?.profile_image_url || profile.profile_image_url || null;
      break;
    }
    case "facebook": {
      platformAccountId = profile.id;
      displayName = profile.name;
      email = profile.email;
      profilePicture = profile.picture?.data?.url || null;
      break;
    }
    case "tiktok": {
      platformAccountId = profile.open_id || profile.union_id;
      username = profile.username;
      displayName = profile.display_name;
      profilePicture = profile.avatar_url;
      break;
    }
    case "threads": {
      platformAccountId = profile.id || tokenData.user_id;
      username = profile.username || null;
      displayName = profile.name || profile.username || null;
      profilePicture = profile.threads_profile_picture_url || null;
      break;
    }
    case "linkedin": {
      platformAccountId = profile.sub || profile.id;
      username = profile.email || null;
      displayName = profile.name || profile.given_name || null;
      email = profile.email || null;
      profilePicture = profile.picture || null;
      break;
    }
    case "pinterest": {
      platformAccountId = profile.id || profile.username;
      username = profile.username || null;
      displayName = profile.profile_name || profile.business_name || profile.username || null;
      profilePicture = profile.profile_image?.url || profile.profile_image || null;
      break;
    }
    case "youtube": {
      platformAccountId = profile.id || profile.sub;
      displayName = profile.name;
      email = profile.email;
      profilePicture = profile.picture;
      break;
    }
    default: {
      platformAccountId = profile.id || profile.sub;
    }
  }

  return { platformAccountId, username, displayName, email, profilePicture };
}

export async function handleGenericCallback(ctx: CallbackContext): Promise<NextResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external API responses from multiple platforms
  let profile: any;
  try {
    profile = await fetchUserProfile(ctx.platform, ctx.accessToken);
  } catch (profileError) {
    if (ctx.platform === "threads" && ctx.tokenData.user_id != null) {
      authLogger.info(
        { userId: ctx.tokenData.user_id },
        "Threads /me failed, trying direct user_id fetch (consider adding user as Threads Tester)",
      );
      try {
        const directUrl = new URL(`https://graph.threads.net/v1.0/${ctx.tokenData.user_id}`);
        directUrl.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
        directUrl.searchParams.set("access_token", ctx.accessToken);
        const directResponse = await fetch(directUrl.toString());
        profile = directResponse.ok ? await directResponse.json() : { id: String(ctx.tokenData.user_id) };
      } catch {
        profile = { id: String(ctx.tokenData.user_id) };
      }
    } else {
      throw profileError;
    }
  }

  const { platformAccountId, username, displayName, email, profilePicture } = extractProfileData(
    ctx.platform,
    profile,
    ctx.tokenData,
  );

  const expiresAt = ctx.expiresIn ? new Date(Date.now() + ctx.expiresIn * 1000) : null;

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: ctx.platform,
    platformAccountId,
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken,
    expiresAt,
    scope: ctx.scope ?? null,
    username,
    displayName,
    email,
    profilePicture,
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts?success=true&platform=${ctx.platform}`);
}
