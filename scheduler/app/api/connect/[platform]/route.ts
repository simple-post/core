import { type NextRequest, NextResponse } from "next/server";

import { handoffSource } from "@/lib/accounts/assistant-handoff";
import { measurementFailure, recordFunnelEvent } from "@/lib/analytics/events";
import { isSocialPlatformEnabled } from "@/lib/config";
import { env } from "@/lib/env";
import { hasFeature, requireSocialInbox } from "@/lib/features";
import { serverMessage } from "@/lib/i18n/server";
import { authLogger } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { getPlatformOAuthConfig, createOAuthState, generatePkce, setPkceCookie } from "@/lib/oauth";
import { withAnalyticsScopes } from "@/lib/post-analytics/permissions";
import { prisma } from "@/lib/prisma";
import { enabledInboxScopes } from "@/lib/social/permissions";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  let source: "assistant_handoff" | undefined;
  let measurementUserId: string | null = null;
  let measurementPlatform = "unknown";
  try {
    const { platform } = await params;
    measurementPlatform = platform;
    const session = await requireAuth(request, { action: "connect_social_account", platform });
    measurementUserId = session.user.id;
    source = handoffSource(request.nextUrl.searchParams.get("handoffToken"), session.user.id, platform);
    await recordFunnelEvent(measurementUserId, "social_connection_started", { properties: { platform, source } });

    if (!isSocialPlatformEnabled(platform)) {
      throw new BadRequestError(serverMessage("Social platform is not enabled in this environment"));
    }

    const config = getPlatformOAuthConfig(platform);
    if (!config || !config.clientId) {
      throw new BadRequestError(serverMessage("Platform not supported or not configured"));
    }

    const baseURL = env.NEXT_PUBLIC_APP_URL;
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    const inboxAccountId = request.nextUrl.searchParams.get("inboxAccountId");
    const inboxScopes = enabledInboxScopes(platform);
    if (inboxAccountId) {
      await requireSocialInbox(session.user.id);
      const account = await prisma.connectedAccount.findFirst({
        where: { id: inboxAccountId, userId: session.user.id, platform },
        select: { id: true },
      });
      if (!account || inboxScopes.length === 0)
        throw new BadRequestError("Inbox permissions are unavailable for this connection.");
    }

    const analyticsScope = withAnalyticsScopes(platform, config.scope);
    const [analytics, inbox] = await Promise.all([
      analyticsScope !== config.scope && hasFeature(session.user.id, "POST_ANALYTICS"),
      Boolean(inboxAccountId) || (inboxScopes.length > 0 && hasFeature(session.user.id, "SOCIAL_INBOX")),
    ]);
    const scopeWithAnalytics = analytics ? analyticsScope : config.scope;
    const scope = inbox
      ? [...new Set([...scopeWithAnalytics.split(/[\s,]+/u), ...inboxScopes])].join(
          config.scope.includes(",") ? "," : " ",
        )
      : scopeWithAnalytics;
    const state = createOAuthState(
      session.user.id,
      platform,
      source,
      inboxAccountId ?? undefined,
      analytics || inbox ? { scope, analytics, inbox } : undefined,
    );

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scope);
    if ((analytics || inbox) && platform === "facebook") authUrl.searchParams.set("auth_type", "rerequest");
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
        authUrl.searchParams.set("prompt", "consent select_account");
        break;
      }
      case "instagram": {
        authUrl.searchParams.set("enable_fb_login", "0");
        authUrl.searchParams.set("force_authentication", "1");
        break;
      }
    }

    const response = NextResponse.redirect(authUrl.toString());
    authLogger.info({ platform, userId: session.user.id }, "OAuth connection started");
    if (pkceVerifier) {
      setPkceCookie(response, pkceVerifier, platform);
    }
    return response;
  } catch (error) {
    if (measurementUserId)
      await recordFunnelEvent(measurementUserId, "social_connection_failed", {
        properties: { platform: measurementPlatform, source, reason: measurementFailure(error) },
      });
    return handleApiError(error, request);
  }
}
