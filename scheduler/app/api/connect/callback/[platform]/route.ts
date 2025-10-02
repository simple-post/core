import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/auth";

// Token exchange configuration for each platform
const TOKEN_CONFIG: Record<
  string,
  {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    userInfoUrl: string;
  }
> = {
  facebook: {
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
  },
  tiktok: {
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    userInfoUrl: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
  },
  youtube: {
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
};

async function exchangeCodeForToken(platform: string, code: string, redirectUri: string) {
  const config = TOKEN_CONFIG[platform];

  const body: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  // Platform-specific adjustments
  if (platform === "tiktok") {
    body.client_key = config.clientId;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Token exchange failed for ${platform}:`, error);
    throw new Error(`Failed to exchange code for token: ${response.statusText}`);
  }

  return await response.json();
}

async function fetchUserProfile(platform: string, accessToken: string) {
  const config = TOKEN_CONFIG[platform];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  const response = await fetch(config.userInfoUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const data = await response.json();

  // Parse platform-specific response format
  if (platform === "tiktok" && data.data?.user) {
    return data.data.user;
  }

  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Check for OAuth errors
    if (error) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=missing_params`);
    }

    // Verify state parameter
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, "base64").toString());
    } catch {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=invalid_state`);
    }

    const { userId, platform: statePlatform } = stateData;

    if (statePlatform !== platform) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=platform_mismatch`);
    }

    // Exchange code for access token
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    const tokenData = await exchangeCodeForToken(platform, code, redirectUri);

    // Extract tokens based on platform response format
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in;
    const scope = tokenData.scope;

    if (!accessToken) {
      throw new Error("No access token received");
    }

    // Fetch user profile
    const profile = await fetchUserProfile(platform, accessToken);

    // Extract profile data based on platform
    let platformAccountId: string;
    let username: string | null = null;
    let displayName: string | null = null;
    let email: string | null = null;
    let profilePicture: string | null = null;

    switch (platform) {
      case "facebook":
        platformAccountId = profile.id;
        displayName = profile.name;
        email = profile.email;
        profilePicture = profile.picture?.data?.url || null;
        break;
      case "tiktok":
        platformAccountId = profile.open_id || profile.union_id;
        username = profile.username;
        displayName = profile.display_name;
        profilePicture = profile.avatar_url;
        break;
      case "youtube":
        platformAccountId = profile.id || profile.sub;
        displayName = profile.name;
        email = profile.email;
        profilePicture = profile.picture;
        break;
      default:
        platformAccountId = profile.id || profile.sub;
    }

    // Store or update connected account
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await prisma.connectedAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform,
          platformAccountId,
        },
      },
      create: {
        userId,
        platform,
        platformAccountId,
        accessToken,
        refreshToken,
        expiresAt,
        scope,
        username,
        displayName,
        email,
        profilePicture,
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt,
        scope,
        username,
        displayName,
        email,
        profilePicture,
        updatedAt: new Date(),
      },
    });

    // Redirect back to accounts page
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?success=true&platform=${platform}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error details:", errorMessage);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=callback_failed`);
  }
}
