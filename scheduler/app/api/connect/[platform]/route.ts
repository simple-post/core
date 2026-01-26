import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

// OAuth configuration for each platform
const OAUTH_CONFIG: Record<
  string,
  {
    authUrl: string;
    clientId: string;
    scope: string;
    responseType?: string;
  }
> = {
  x: {
    authUrl: "https://twitter.com/i/oauth2/authorize",
    clientId: process.env.X_CLIENT_ID || "",
    scope: "tweet.read tweet.write users.read offline.access",
    responseType: "code",
  },
  facebook: {
    authUrl: "https://www.facebook.com/v24.0/dialog/oauth",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    scope: "public_profile,pages_show_list,pages_manage_posts,business_management",
  },
  instagram: {
    authUrl: "https://www.instagram.com/oauth/authorize",
    clientId: process.env.INSTAGRAM_CLIENT_ID || "",
    scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages",
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize",
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    scope: "user.info.basic,video.upload,video.publish,user.info.profile",
  },
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile",
    responseType: "code",
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    const session = await requireAuth(request);

    const config = OAUTH_CONFIG[platform];
    if (!config || !config.clientId) {
      throw new BadRequestError("Platform not supported or not configured");
    }

    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    // Generate state parameter for CSRF protection
    const state = Buffer.from(
      JSON.stringify({
        userId: session.user.id,
        platform,
        timestamp: Date.now(),
      }),
    ).toString("base64");

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", config.scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", config.responseType || "code");

    // Platform-specific parameters
    switch (platform) {
      case "x": {
        // X requires PKCE
        // Generate code_challenge for PKCE
        const codeVerifier = Buffer.from(crypto.randomUUID() + crypto.randomUUID()).toString("base64url");
        const codeChallenge = Buffer.from(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
        ).toString("base64url");

        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        // Store code_verifier in state for callback
        const xState = Buffer.from(
          JSON.stringify({
            userId: session.user.id,
            platform,
            timestamp: Date.now(),
            codeVerifier,
          }),
        ).toString("base64");
        authUrl.searchParams.set("state", xState);

        break;
      }
      case "tiktok": {
        authUrl.searchParams.set("client_key", config.clientId);

        break;
      }
      case "youtube": {
        // Request offline access to get a refresh token
        authUrl.searchParams.set("access_type", "offline");
        // Force consent screen to get a new refresh token
        authUrl.searchParams.set("prompt", "consent");

        break;
      }
      case "instagram": {
        // Use Instagram Login (not Facebook Login)
        authUrl.searchParams.set("enable_fb_login", "0");
        authUrl.searchParams.set("force_authentication", "1");

        break;
      }
      // No default
    }

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    return handleApiError(error);
  }
}
