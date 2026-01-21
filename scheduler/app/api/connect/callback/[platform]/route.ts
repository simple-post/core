import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authLogger } from "@/lib/logger";

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
  x: {
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    userInfoUrl: "https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name",
  },
  facebook: {
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
  },
  instagram: {
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

async function exchangeCodeForToken(platform: string, code: string, redirectUri: string, codeVerifier?: string) {
  const config = TOKEN_CONFIG[platform];

  const body: Record<string, string> = {
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  // Platform-specific adjustments
  if (platform === "x") {
    // X requires PKCE code_verifier
    if (codeVerifier) {
      body.code_verifier = codeVerifier;
    }
    // X requires Basic Auth with client credentials
  } else if (platform === "tiktok") {
    body.client_key = config.clientId;
    body.client_secret = config.clientSecret;
  } else {
    body.client_secret = config.clientSecret;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // X requires Basic Auth
  if (platform === "x") {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const error = await response.text();
    authLogger.error({ platform, error, status: response.status }, "Token exchange failed");
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

async function fetchInstagramAccounts(accessToken: string) {
  // Fetch user's Facebook Pages
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!pagesResponse.ok) {
    throw new Error(`Failed to fetch Facebook pages: ${pagesResponse.statusText}`);
  }

  const pagesData = await pagesResponse.json();
  const instagramAccounts: Array<{
    businessAccountId: string;
    username: string;
    name: string;
    profilePicture: string;
    pageAccessToken: string;
  }> = [];

  // For each page, check if it has an Instagram Business account
  for (const page of pagesData.data || []) {
    if (page.instagram_business_account) {
      const igAccountId = page.instagram_business_account.id;

      // Fetch Instagram account details
      const igResponse = await fetch(
        `https://graph.facebook.com/v18.0/${igAccountId}?fields=id,username,name,profile_picture_url`,
        {
          headers: { Authorization: `Bearer ${page.access_token}` },
        },
      );

      if (igResponse.ok) {
        const igData = await igResponse.json();
        instagramAccounts.push({
          businessAccountId: igData.id,
          username: igData.username,
          name: igData.name || igData.username,
          profilePicture: igData.profile_picture_url || "",
          pageAccessToken: page.access_token,
        });
      }
    }
  }

  return instagramAccounts;
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

    const { userId, platform: statePlatform, codeVerifier } = stateData;

    if (statePlatform !== platform) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=platform_mismatch`);
    }

    // Exchange code for access token
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    const tokenData = await exchangeCodeForToken(platform, code, redirectUri, codeVerifier);

    // Extract tokens based on platform response format
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in;
    const scope = tokenData.scope;

    if (!accessToken) {
      throw new Error("No access token received");
    }

    // Special handling for Instagram - fetch Instagram Business accounts
    if (platform === "instagram") {
      const instagramAccounts = await fetchInstagramAccounts(accessToken);

      if (instagramAccounts.length === 0) {
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=no_instagram_accounts&message=${encodeURIComponent("No Instagram Business accounts found. Make sure you have an Instagram Business account connected to a Facebook Page.")}`,
        );
      }

      // Store each Instagram Business account
      for (const igAccount of instagramAccounts) {
        await prisma.connectedAccount.upsert({
          where: {
            userId_platform_platformAccountId: {
              userId,
              platform: "instagram",
              platformAccountId: igAccount.businessAccountId,
            },
          },
          create: {
            userId,
            platform: "instagram",
            platformAccountId: igAccount.businessAccountId,
            accessToken: igAccount.pageAccessToken,
            refreshToken,
            expiresAt: null, // Page access tokens don't expire if properly set up
            scope,
            username: igAccount.username,
            displayName: igAccount.name,
            email: null,
            profilePicture: igAccount.profilePicture,
          },
          update: {
            accessToken: igAccount.pageAccessToken,
            refreshToken,
            scope,
            username: igAccount.username,
            displayName: igAccount.name,
            profilePicture: igAccount.profilePicture,
            updatedAt: new Date(),
          },
        });
      }

      // Redirect back to accounts page with success
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/accounts?success=true&platform=instagram&count=${instagramAccounts.length}`,
      );
    }

    // Fetch user profile for other platforms
    const profile = await fetchUserProfile(platform, accessToken);

    // Extract profile data based on platform
    let platformAccountId: string;
    let username: string | null = null;
    let displayName: string | null = null;
    let email: string | null = null;
    let profilePicture: string | null = null;

    switch (platform) {
      case "x":
        platformAccountId = profile.data?.id || profile.id;
        username = profile.data?.username || profile.username;
        displayName = profile.data?.name || profile.name;
        profilePicture = profile.data?.profile_image_url || profile.profile_image_url || null;
        break;
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=${encodeURIComponent(errorMessage)}`,
    );
  }
}
