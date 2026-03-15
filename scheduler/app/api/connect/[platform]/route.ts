import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getPlatformOAuthConfig, createOAuthState, generatePkce, setPkceCookie } from "@/lib/oauth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    const session = await requireAuth(request);

    const config = getPlatformOAuthConfig(platform);
    if (!config || !config.clientId) {
      throw new BadRequestError("Platform not supported or not configured");
    }

    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    const state = createOAuthState(session.user.id, platform);

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", config.scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", config.responseType);

    // PKCE for platforms that require it
    let pkceVerifier: string | undefined;
    if (config.requiresPkce) {
      const { codeVerifier, codeChallenge } = await generatePkce();
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      pkceVerifier = codeVerifier;
    }

    // Platform-specific parameters
    switch (platform) {
      case "tiktok": {
        authUrl.searchParams.set("client_key", config.clientId);
        break;
      }
      case "youtube": {
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        break;
      }
      case "instagram": {
        authUrl.searchParams.set("enable_fb_login", "0");
        authUrl.searchParams.set("force_authentication", "1");
        break;
      }
    }

    const response = NextResponse.redirect(authUrl.toString());
    if (pkceVerifier) {
      setPkceCookie(response, pkceVerifier, platform);
    }
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
