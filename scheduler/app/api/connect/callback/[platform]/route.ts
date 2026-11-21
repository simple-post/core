import { type NextRequest, NextResponse } from "next/server";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { isSocialPlatformEnabled } from "@/lib/config";
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
  const { platform } = await params;
  let source: "assistant_handoff" | undefined;
  let measurementUserId: string | null = null;
  try {
    const signed = request.nextUrl.searchParams.get("state");
    if (signed) {
      const context = verifyOAuthState(signed);
      if (context.platform === platform) {
        measurementUserId = context.userId;
        source = context.source;
      }
    }
  } catch {
    /* Unverified callbacks remain anonymous in operational counts. */
  }
  const errorRedirect = (code: Parameters<typeof getErrorRedirectUrl>[0]) => {
    const url = new URL(getErrorRedirectUrl(code, baseURL));
    if (source) url.searchParams.set("source", source);
    return url.href;
  };
  const failure = async (reason: string) =>
    measurementUserId &&
    recordFunnelEvent(
      measurementUserId,
      reason === "authorization_denied" ? "social_connection_cancelled" : "social_connection_failed",
      { properties: { platform, reason, source } },
    );

  try {
    if (!isSocialPlatformEnabled(platform)) {
      authLogger.warn({ platform }, "OAuth callback rejected for disabled platform");
      await failure("unknown_error");
      return NextResponse.redirect(errorRedirect("unknown_error"));
    }
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorReason = searchParams.get("error_reason");
    const errorDescription = searchParams.get("error_description");

    if (error || errorReason) {
      authLogger.warn({ platform, error, errorReason, errorDescription }, "OAuth provider returned error");
      await failure("authorization_denied");
      return NextResponse.redirect(errorRedirect("authorization_denied"));
    }

    if (!code || !state) {
      authLogger.warn({ hasCode: !!code, hasState: !!state, platform }, "Missing OAuth params");
      await failure("missing_params");
      return NextResponse.redirect(errorRedirect("missing_params"));
    }

    // Verify HMAC-signed state and check expiry
    let stateData;
    try {
      stateData = verifyOAuthState(state);
    } catch (stateError) {
      if (stateError instanceof OAuthStateError) {
        return NextResponse.redirect(errorRedirect(stateError.code as "invalid_state" | "state_expired"));
      }
      await failure("invalid_state");
      return NextResponse.redirect(errorRedirect("invalid_state"));
    }

    const { userId, platform: statePlatform } = stateData;
    measurementUserId = userId;

    if (statePlatform !== platform) {
      await failure("platform_mismatch");
      return NextResponse.redirect(errorRedirect("platform_mismatch"));
    }

    // Validate session matches state userId
    const session = await requireAuth(request, { action: "connect_social_account_callback", platform });
    if (session.user.id !== userId) {
      authLogger.warn({ stateUserId: userId, sessionUserId: session.user.id }, "OAuth session mismatch");
      await failure("session_mismatch");
      return NextResponse.redirect(errorRedirect("session_mismatch"));
    }

    const config = getPlatformOAuthConfig(platform);
    if (!config) {
      await failure("unknown_error");
      return NextResponse.redirect(errorRedirect("unknown_error"));
    }

    // Read PKCE verifier from encrypted cookie
    let codeVerifier: string | undefined;
    if (config.requiresPkce) {
      const verifier = getPkceVerifier(request, platform);
      if (!verifier) {
        await failure("pkce_missing");
        return NextResponse.redirect(errorRedirect("pkce_missing"));
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
      authLogger.warn({ platform, userId }, "OAuth token response did not contain an access token");
      await failure("no_access_token");
      return NextResponse.redirect(errorRedirect("no_access_token"));
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
      source,
    });

    // A provider can return a selection screen or an error; neither is a completed connection.
    const location = response.headers.get("location");
    if (location) {
      const destination = new URL(location);
      if (destination.pathname === "/accounts" && destination.searchParams.get("success") === "true") {
        await recordFunnelEvent(userId, "social_connection_completed", {
          key: `oauth:${state}`,
          properties: { platform, source },
        });
      }
      if (destination.pathname === "/accounts" && destination.searchParams.has("error"))
        await failure("provider_setup_incomplete");
      if (source && destination.origin === new URL(baseURL).origin) {
        destination.searchParams.set("source", source);
        response.headers.set("location", destination.href);
      }
    }

    // Clear PKCE cookie on success
    if (config.requiresPkce) {
      clearPkceCookie(response, platform);
    }

    return response;
  } catch (error) {
    const code = mapErrorToCode(error);
    if (code === "session_mismatch") {
      authLogger.warn({ platform, code }, "OAuth callback requires a fresh login");
    } else {
      authLogger.error({ platform, err: serializeError(error), code }, "OAuth callback failed");
    }
    await failure(code);
    return NextResponse.redirect(errorRedirect(code));
  }
}
