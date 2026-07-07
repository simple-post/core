import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { authLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import {
  getPlatformOAuthConfig,
  verifyOAuthState,
  getPkceVerifier,
  clearPkceCookie,
  getErrorRedirectUrl,
  mapErrorToCode,
  exchangeCodeForToken,
  exchangeCodeForBlueskyToken,
  handlePlatformCallback,
} from "@/lib/oauth";
import { getRefreshTokenExpiresAt } from "@/lib/oauth/credential-health";
import { OAuthStateError } from "@/lib/oauth/state";

import type { Prisma } from "@prisma/client";

function mergeTokenMetadata(
  current: Prisma.InputJsonValue | null,
  tokenData: Record<string, unknown>,
): Prisma.InputJsonValue | null {
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt(tokenData, new Date());
  if (!refreshTokenExpiresAt) {
    return current;
  }

  const base =
    current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};

  return {
    ...base,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  } as Prisma.InputJsonObject;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const baseURL = env.NEXT_PUBLIC_APP_URL;

  try {
    const { platform } = await params;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorReason = searchParams.get("error_reason");
    const errorDescription = searchParams.get("error_description");

    if (error || errorReason) {
      authLogger.warn({ platform, error, errorReason, errorDescription }, "OAuth provider returned error");
      return NextResponse.redirect(getErrorRedirectUrl("authorization_denied", baseURL));
    }

    if (!code || !state) {
      authLogger.warn({ hasCode: !!code, hasState: !!state, platform }, "Missing OAuth params");
      return NextResponse.redirect(getErrorRedirectUrl("missing_params", baseURL));
    }

    // Verify HMAC-signed state and check expiry
    let stateData;
    try {
      stateData = verifyOAuthState(state);
    } catch (stateError) {
      if (stateError instanceof OAuthStateError) {
        return NextResponse.redirect(
          getErrorRedirectUrl(stateError.code as "invalid_state" | "state_expired", baseURL),
        );
      }
      return NextResponse.redirect(getErrorRedirectUrl("invalid_state", baseURL));
    }

    const { userId, platform: statePlatform } = stateData;

    if (statePlatform !== platform) {
      return NextResponse.redirect(getErrorRedirectUrl("platform_mismatch", baseURL));
    }

    // Validate session matches state userId
    const session = await requireAuth(request);
    if (session.user.id !== userId) {
      authLogger.warn({ stateUserId: userId, sessionUserId: session.user.id }, "OAuth session mismatch");
      return NextResponse.redirect(getErrorRedirectUrl("session_mismatch", baseURL));
    }

    const config = getPlatformOAuthConfig(platform);
    if (!config) {
      return NextResponse.redirect(getErrorRedirectUrl("unknown_error", baseURL));
    }

    // Read PKCE verifier from encrypted cookie
    let codeVerifier: string | undefined;
    if (config.requiresPkce) {
      const verifier = getPkceVerifier(request, platform);
      if (!verifier) {
        return NextResponse.redirect(getErrorRedirectUrl("pkce_missing", baseURL));
      }
      codeVerifier = verifier;
    }

    // Exchange code for access token
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;
    let tokenMetadata: Prisma.InputJsonValue | null = null;

    const tokenData =
      platform === "bluesky"
        ? await (async () => {
            const exchange = await exchangeCodeForBlueskyToken(code, redirectUri, codeVerifier);
            tokenMetadata = {
              dpopPublicJwk: exchange.dpopPublicJwk,
              dpopPrivateJwk: exchange.dpopPrivateJwk,
            } as Prisma.InputJsonValue;
            return exchange.tokenData;
          })()
        : await exchangeCodeForToken(platform, code, redirectUri, codeVerifier);

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.redirect(getErrorRedirectUrl("no_access_token", baseURL));
    }
    tokenMetadata = mergeTokenMetadata(tokenMetadata, tokenData);

    // Dispatch to platform-specific handler
    const response = await handlePlatformCallback({
      userId,
      platform,
      baseURL,
      tokenData,
      accessToken,
      refreshToken: tokenData.refresh_token || null,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
      tokenMetadata,
    });

    // Clear PKCE cookie on success
    if (config.requiresPkce) {
      clearPkceCookie(response, platform);
    }

    return response;
  } catch (error) {
    const code = mapErrorToCode(error);
    authLogger.error({ err: serializeError(error), code }, "OAuth callback failed");
    return NextResponse.redirect(getErrorRedirectUrl(code, baseURL));
  }
}
