import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

/** Platform-specific profile shapes returned by each OAuth provider's userinfo endpoint. */
interface XProfile {
  data?: { id: string; username: string; name: string; profile_image_url?: string };
  id?: string;
  username?: string;
  name?: string;
  profile_image_url?: string;
}

interface FacebookProfile {
  id: string;
  name: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

interface TikTokProfile {
  open_id?: string;
  union_id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
}

interface ThreadsProfile {
  id?: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
}

interface LinkedInProfile {
  sub?: string;
  id?: string;
  email?: string;
  name?: string;
  given_name?: string;
  picture?: string;
}

interface PinterestProfile {
  id?: string;
  username?: string;
  profile_name?: string;
  business_name?: string;
  profile_image?: { url?: string } | string;
}

interface YouTubeProfile {
  id?: string;
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface DefaultProfile {
  id?: string;
  sub?: string;
}

type PlatformProfile =
  | XProfile
  | FacebookProfile
  | TikTokProfile
  | ThreadsProfile
  | LinkedInProfile
  | PinterestProfile
  | YouTubeProfile
  | DefaultProfile;

async function fetchUserProfile(platform: string, accessToken: string): Promise<PlatformProfile> {
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

function extractProfileData(platform: string, profile: PlatformProfile, tokenData: CallbackContext["tokenData"]) {
  let platformAccountId: string;
  let username: string | null = null;
  let displayName: string | null = null;
  let email: string | null = null;
  let profilePicture: string | null = null;

  switch (platform) {
    case "x": {
      const p = profile as XProfile;
      platformAccountId = p.data?.id || p.id || "";
      username = p.data?.username || p.username || null;
      displayName = p.data?.name || p.name || null;
      profilePicture = p.data?.profile_image_url || p.profile_image_url || null;
      break;
    }
    case "facebook": {
      const p = profile as FacebookProfile;
      platformAccountId = p.id;
      displayName = p.name;
      email = p.email || null;
      profilePicture = p.picture?.data?.url || null;
      break;
    }
    case "tiktok": {
      const p = profile as TikTokProfile;
      platformAccountId = p.open_id || p.union_id || "";
      username = p.username || null;
      displayName = p.display_name || null;
      profilePicture = p.avatar_url || null;
      break;
    }
    case "threads": {
      const p = profile as ThreadsProfile;
      platformAccountId = p.id || String(tokenData.user_id ?? "");
      username = p.username || null;
      displayName = p.name || p.username || null;
      profilePicture = p.threads_profile_picture_url || null;
      break;
    }
    case "linkedin": {
      const p = profile as LinkedInProfile;
      platformAccountId = p.sub || p.id || "";
      username = p.email || null;
      displayName = p.name || p.given_name || null;
      email = p.email || null;
      profilePicture = p.picture || null;
      break;
    }
    case "pinterest": {
      const p = profile as PinterestProfile;
      platformAccountId = p.id || p.username || "";
      username = p.username || null;
      displayName = p.profile_name || p.business_name || p.username || null;
      const img = p.profile_image;
      profilePicture = (typeof img === "object" ? img?.url : img) || null;
      break;
    }
    case "youtube": {
      const p = profile as YouTubeProfile;
      platformAccountId = p.id || p.sub || "";
      displayName = p.name || null;
      email = p.email || null;
      profilePicture = p.picture || null;
      break;
    }
    default: {
      const p = profile as DefaultProfile;
      platformAccountId = p.id || p.sub || "";
    }
  }

  return { platformAccountId, username, displayName, email, profilePicture };
}

export async function handleGenericCallback(ctx: CallbackContext): Promise<NextResponse> {
  let profile: PlatformProfile;
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
