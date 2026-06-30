/**
 * TikTok token refresh - access tokens expire after 24 hours.
 * Refresh tokens are valid for 365 days.
 * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
 */

import { postingLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

const TIKTOK_TOKEN_REFRESH_BUFFER_SEC = 5 * 60; // Refresh if expiring in next 5 minutes

export interface TikTokRefreshResult {
  account: ConnectedAccount;
  /**
   * Set when the access token is (or is about to be) expired and could not be
   * refreshed. Posting with the stale token is guaranteed to fail with an
   * opaque platform error, so callers should fail fast with this message
   * instead of attempting the publish.
   */
  error?: string;
}

export async function refreshTikTokTokenIfNeeded(account: ConnectedAccount): Promise<TikTokRefreshResult> {
  if (account.platform.toLowerCase() !== "tiktok") {
    return { account };
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = account.expiresAt ? Math.floor(account.expiresAt.getTime() / 1000) : 0;
  const needsRefresh = !account.expiresAt || expiresAtSec <= nowSec + TIKTOK_TOKEN_REFRESH_BUFFER_SEC;

  if (!needsRefresh) {
    return { account };
  }

  if (!clientKey || !clientSecret) {
    postingLogger.warn(
      { accountId: account.id, platform: "tiktok" },
      "TikTok client credentials not configured - cannot refresh token",
    );
    return {
      account,
      error:
        "TikTok access token is expired and TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not configured, so it cannot be refreshed.",
    };
  }

  if (!account.refreshToken) {
    postingLogger.warn(
      { accountId: account.id, platform: "tiktok" },
      "No refresh token for TikTok account - user must reconnect",
    );
    return {
      account,
      error: "TikTok access token is expired and no refresh token is stored. Reconnect the TikTok account.",
    };
  }

  const log = postingLogger.child({ fn: "refreshTikTokTokenIfNeeded", accountId: account.id, platform: "tiktok" });
  log.info("Refreshing expired or expiring TikTok access token");

  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    });

    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await response.json();

    if (!response.ok) {
      log.error(
        { status: response.status, error: data.error, error_description: data.error_description },
        "TikTok token refresh failed",
      );
      return {
        account,
        error: `TikTok token refresh failed (${response.status}): ${data.error_description || data.error || "unknown error"}. Reconnect the TikTok account if this persists.`,
      };
    }

    const accessToken = data.access_token as string | undefined;
    const refreshToken = (data.refresh_token ?? account.refreshToken) as string;
    const expiresIn = data.expires_in as number | undefined;

    if (!accessToken) {
      log.error("No access_token in TikTok refresh response");
      return { account, error: "TikTok token refresh returned no access token. Reconnect the TikTok account." };
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        ...encryptConnectedAccountSecrets({ accessToken, refreshToken }),
        expiresAt,
        updatedAt: new Date(),
      },
    });

    log.info("TikTok token refreshed successfully");

    return {
      account: {
        ...account,
        accessToken,
        refreshToken,
        expiresAt,
      },
    };
  } catch (error) {
    log.error({ err: error }, "TikTok token refresh failed with exception");
    return {
      account,
      error: `TikTok token refresh failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
