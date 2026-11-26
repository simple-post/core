import { type NextRequest, NextResponse } from "next/server";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { isSocialPlatformEnabled } from "@/lib/config";
import { env } from "@/lib/env";
import { hasFeature, requireSocialInbox } from "@/lib/features";
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
import { prisma } from "@/lib/prisma";
import { enabledInboxScopes, hasInboxScopes } from "@/lib/social/permissions";
import { workspaceConnections } from "@/lib/workspaces/connections";

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
  let workspaceId: string | undefined;
  let pilotConnection = false;
  let source: "assistant_handoff" | undefined;
  let measurementUserId: string | null = null;
  try {
    const signed = request.nextUrl.searchParams.get("state");
    if (signed) {
      const context = verifyOAuthState(signed);
      if (context.platform === platform) {
        measurementUserId = context.userId;
        source = context.source;
        workspaceId = context.workspaceId;
        pilotConnection = Boolean(context.workspaceId || context.pilotScopes || context.reconnectAccountId);
      }
    }
  } catch {
    /* Unverified callbacks remain anonymous in operational counts. */
  }
  const errorRedirect = (code: Parameters<typeof getErrorRedirectUrl>[0]) => {
    const url = new URL(getErrorRedirectUrl(code, baseURL));
    if (source) url.searchParams.set("source", source);
    if (workspaceId) url.searchParams.set("workspace", workspaceId);
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
      const redirect = new URL(errorRedirect("authorization_denied"));
      if (pilotConnection && platform === "tiktok" && (error === "invalid_scope" || errorReason === "invalid_scope"))
        redirect.searchParams.set("scopeUnavailable", "tiktok");
      return NextResponse.redirect(redirect);
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

    await workspaceConnections(userId, stateData.workspaceId ?? null, true);
    const { pilotScopes } = stateData;
    if (pilotScopes?.analytics && !(await hasFeature(userId, "POST_ANALYTICS"))) {
      return NextResponse.redirect(errorRedirect("invalid_state"));
    }
    if (stateData.inboxAccountId || pilotScopes?.inbox) await requireSocialInbox(userId);

    let inboxIdentity: string | undefined;
    const inboxScopes = stateData.inboxAccountId ? enabledInboxScopes(platform) : [];
    if (stateData.inboxAccountId) {
      const account = await prisma.connectedAccount.findFirst({
        where: { id: stateData.inboxAccountId, userId, platform, workspaceId: workspaceId ?? null },
        select: { platformAccountId: true },
      });
      if (!account || inboxScopes.length === 0) return NextResponse.redirect(errorRedirect("invalid_state"));
      inboxIdentity = account.platformAccountId;
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
    if (platform === "tiktok" && (typeof tokenData.refresh_token !== "string" || !tokenData.refresh_token.trim())) {
      authLogger.warn({ platform, userId }, "OAuth token response did not contain a refresh token");
      await failure("token_exchange_failed");
      return NextResponse.redirect(errorRedirect("token_exchange_failed"));
    }
    if (inboxIdentity || pilotScopes) {
      if (platform === "facebook") {
        const response = await fetch("https://graph.facebook.com/v25.0/me/permissions", {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return NextResponse.redirect(errorRedirect("token_exchange_failed"));
        const permissions = (await response.json()) as { data?: Array<{ status: string; permission: string }> };
        tokenData.scope = permissions.data
          ?.filter((row) => row.status === "granted")
          .map((row) => row.permission)
          .join(",");
      } else if (platform === "threads" && !tokenData.scope) {
        const url = new URL("https://graph.threads.net/debug_token");
        url.searchParams.set("input_token", accessToken);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer TH|${config.clientId}|${config.clientSecret}` },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return NextResponse.redirect(errorRedirect("token_exchange_failed"));
        const { data } = await response.json();
        tokenData.scope = data?.is_valid === true && Array.isArray(data.scopes) ? data.scopes.join(" ") : undefined;
      } else if (platform !== "instagram" && platform !== "tiktok" && platform !== "threads") {
        // OAuth permits omitting scope when it matches the authorization request.
        tokenData.scope ??= pilotScopes?.scope ?? [...config.scope.split(/[\s,]+/u), ...inboxScopes].join(" ");
      }
      if (inboxIdentity && !hasInboxScopes(tokenData.scope, [...config.scope.split(/[\s,]+/u), ...inboxScopes])) {
        return NextResponse.redirect(`${baseURL}/inbox?connection=permissions`);
      }
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
      inboxIdentity,
      workspaceId,
      reconnectAccountId: stateData.reconnectAccountId,
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
      if ((source || workspaceId) && destination.origin === new URL(baseURL).origin) {
        if (source) destination.searchParams.set("source", source);
        if (workspaceId) destination.searchParams.set("workspace", workspaceId);
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
