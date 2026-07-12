import crypto from "node:crypto";

import { derToRaw } from "@simple-post/sdk";

import { createLogger, serializeError } from "@/lib/logger";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
  encryptTokenMetadata,
} from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount, ConnectedAccountCredentialStatus, ConnectedAccountCredentialState } from "@/types";

import type { Prisma } from "@prisma/client";

export const POST_CREDENTIAL_MIN_VALIDITY_MS = 5 * 60 * 1000;
/**
 * How far ahead the background sweep refreshes access tokens. Kept small on
 * purpose: several providers rotate refresh tokens on every refresh, so each
 * refresh is a small risk (token family loss if the process dies before the
 * new tokens are persisted). A wide window would re-refresh short-lived
 * tokens (X ~2h, Google ~1h) on every dispatcher run.
 */
export const SWEEP_CREDENTIAL_MIN_VALIDITY_MS = 30 * 60 * 1000;
/** Window used for "expires soon, reconnect" warnings shown to users. */
export const CREDENTIAL_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum wait before the background sweep retries a failed refresh. */
export const FAILED_REFRESH_RETRY_INTERVAL_MS = 60 * 60 * 1000;

const DEFAULT_REFRESH_SWEEP_LIMIT = 100;
const REFRESH_SWEEP_CONCURRENCY = 5;
const REFRESH_REQUEST_TIMEOUT_MS = 15_000;

const log = createLogger("connected-account-credentials");

type CredentialSeverity = ConnectedAccountCredentialStatus["severity"];
type CredentialAction = ConnectedAccountCredentialStatus["action"];

interface RefreshReadiness {
  ready: boolean;
  supported: boolean;
  reason?: string;
}

interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
  refreshTokenExpiresAt?: Date | null;
}

export interface RefreshConnectedAccountResult {
  account: ConnectedAccount;
  refreshed: boolean;
  /**
   * Set when the access token is known to be expired and could not be
   * refreshed. Publishing with the stale token is guaranteed to fail with an
   * opaque platform error, so callers should fail fast with this message.
   */
  error?: string;
  /**
   * Set whenever a needed refresh did not complete, even if the current
   * access token is still valid (in which case `error` is unset and callers
   * should proceed with the existing token).
   */
  refreshError?: string;
  status: ConnectedAccountCredentialStatus;
}

export interface CredentialPublishIssue {
  accountId: string;
  platform: string;
  message: string;
}

export interface RefreshExpiringAccountsResult {
  checked: number;
  refreshed: number;
  failed: number;
  skipped: number;
  failures: CredentialPublishIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    bluesky: "Bluesky",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    pinterest: "Pinterest",
    slack: "Slack",
    telegram: "Telegram",
    threads: "Threads",
    tiktok: "TikTok",
    twitter: "X",
    x: "X",
    youtube: "YouTube",
  };
  return labels[platform.toLowerCase()] ?? platform;
}

function getTokenMetadata(account: ConnectedAccount): Record<string, unknown> {
  return isPlainObject(account.tokenMetadata) ? account.tokenMetadata : {};
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function metadataDate(account: ConnectedAccount, key: string): Date | null {
  return parseDate(getTokenMetadata(account)[key]);
}

function secondsField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function dateFromSeconds(seconds: number | undefined, now: Date): Date | null {
  return seconds ? new Date(now.getTime() + seconds * 1000) : null;
}

/**
 * Extracts the refresh-token expiry from an OAuth token response
 * (`refresh_token_expires_in` on most providers, `refresh_expires_in` on
 * TikTok). Shared by the connect callback and the refresh flow.
 */
export function getRefreshTokenExpiresAt(data: Record<string, unknown>, now: Date): Date | null {
  return (
    dateFromSeconds(secondsField(data, "refresh_token_expires_in"), now) ??
    dateFromSeconds(secondsField(data, "refresh_expires_in"), now)
  );
}

function isNonExpiringPlatform(platform: string): boolean {
  return platform === "telegram" || platform === "facebook";
}

function getXClientId(): string {
  return process.env.X_CLIENT_ID || "";
}

function getXClientSecret(): string {
  return process.env.X_CLIENT_SECRET || "";
}

function getYouTubeClientId(): string {
  return process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
}

function getYouTubeClientSecret(): string {
  return process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
}

function getRefreshReadiness(account: ConnectedAccount): RefreshReadiness {
  const platform = account.platform.toLowerCase();
  const metadata = getTokenMetadata(account);

  switch (platform) {
    case "x":
    case "twitter": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!getXClientId()) return { supported: true, ready: false, reason: "X client ID is not configured" };
      return { supported: true, ready: true };
    }
    case "youtube": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!getYouTubeClientId() || !getYouTubeClientSecret()) {
        return { supported: true, ready: false, reason: "Google OAuth client credentials are not configured" };
      }
      return { supported: true, ready: true };
    }
    case "instagram":
    case "threads": {
      return account.accessToken
        ? { supported: true, ready: true }
        : { supported: true, ready: false, reason: "no access token is stored" };
    }
    case "tiktok": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
        return { supported: true, ready: false, reason: "TikTok client credentials are not configured" };
      }
      return { supported: true, ready: true };
    }
    case "bluesky": {
      const clientId = typeof metadata.clientId === "string" ? metadata.clientId : process.env.BLUESKY_CLIENT_ID || "";
      const tokenUrl = typeof metadata.tokenUrl === "string" ? metadata.tokenUrl : "";
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!clientId) return { supported: true, ready: false, reason: "Bluesky client ID is not configured" };
      if (!tokenUrl) return { supported: true, ready: false, reason: "Bluesky token URL is missing" };
      return { supported: true, ready: true };
    }
    case "linkedin": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
        return { supported: true, ready: false, reason: "LinkedIn client credentials are not configured" };
      }
      return { supported: true, ready: true };
    }
    case "pinterest": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!process.env.PINTEREST_CLIENT_ID || !process.env.PINTEREST_CLIENT_SECRET) {
        return { supported: true, ready: false, reason: "Pinterest client credentials are not configured" };
      }
      return { supported: true, ready: true };
    }
    case "slack": {
      if (!account.refreshToken) return { supported: true, ready: false, reason: "no refresh token is stored" };
      if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
        return { supported: true, ready: false, reason: "Slack client credentials are not configured" };
      }
      return { supported: true, ready: true };
    }
    default: {
      return { supported: false, ready: false, reason: "automatic refresh is not implemented for this platform" };
    }
  }
}

function status(
  account: ConnectedAccount,
  state: ConnectedAccountCredentialState,
  severity: CredentialSeverity,
  label: string,
  message: string,
  action: CredentialAction,
  canRefresh: boolean,
): ConnectedAccountCredentialStatus {
  const refreshTokenExpiresAt = metadataDate(account, "refreshTokenExpiresAt");
  const metadata = getTokenMetadata(account);
  return {
    action,
    canRefresh,
    expiresAt: account.expiresAt?.toISOString() ?? null,
    label,
    lastRefreshAttemptAt: typeof metadata.lastRefreshAttemptAt === "string" ? metadata.lastRefreshAttemptAt : null,
    lastRefreshError: typeof metadata.lastRefreshError === "string" ? metadata.lastRefreshError : null,
    message,
    refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() ?? null,
    severity,
    state,
  };
}

export function getConnectedAccountCredentialStatus(
  account: ConnectedAccount,
  options?: { now?: Date; warningWindowMs?: number },
): ConnectedAccountCredentialStatus {
  const now = options?.now ?? new Date();
  const warningWindowMs = options?.warningWindowMs ?? CREDENTIAL_WARNING_WINDOW_MS;
  const platform = account.platform.toLowerCase();
  const label = platformLabel(platform);
  const readiness = getRefreshReadiness(account);
  const canRefresh = readiness.ready;
  const refreshTokenExpiresAt = metadataDate(account, "refreshTokenExpiresAt");

  if (refreshTokenExpiresAt && refreshTokenExpiresAt.getTime() <= now.getTime()) {
    return status(
      account,
      "reauth_required",
      "error",
      "Reconnect",
      `${label} refresh token has expired. Reconnect this account before posting.`,
      "reconnect",
      false,
    );
  }

  if (
    refreshTokenExpiresAt &&
    refreshTokenExpiresAt.getTime() <= now.getTime() + warningWindowMs &&
    readiness.supported
  ) {
    return status(
      account,
      canRefresh ? "refreshing_soon" : "reauth_required",
      canRefresh ? "warning" : "error",
      canRefresh ? "Refreshing soon" : "Reconnect",
      canRefresh
        ? `${label} refresh token expires soon. SimplePost will refresh it before it expires.`
        : `${label} refresh token expires soon and ${readiness.reason ?? "cannot be refreshed"}. Reconnect this account.`,
      canRefresh ? "refresh" : "reconnect",
      canRefresh,
    );
  }

  if (!account.expiresAt) {
    if (isNonExpiringPlatform(platform)) {
      return status(
        account,
        "non_expiring",
        "ok",
        "Active",
        `${label} credentials do not have a known expiry.`,
        "none",
        false,
      );
    }
    return status(
      account,
      readiness.ready ? "healthy" : "unknown",
      readiness.ready ? "ok" : "warning",
      readiness.ready ? "Active" : "Check credentials",
      readiness.ready
        ? `${label} credentials are refreshable.`
        : `${label} credentials do not have an expiry recorded, and ${readiness.reason ?? "refresh readiness is unknown"}.`,
      readiness.ready ? "none" : "reconnect",
      readiness.ready,
    );
  }

  if (account.expiresAt.getTime() <= now.getTime()) {
    return status(
      account,
      canRefresh ? "refreshing_soon" : "reauth_required",
      canRefresh ? "warning" : "error",
      canRefresh ? "Refreshing" : "Reconnect",
      canRefresh
        ? `${label} access token is expired. SimplePost will refresh it before posting.`
        : `${label} access token is expired and ${readiness.reason ?? "cannot be refreshed"}. Reconnect this account.`,
      canRefresh ? "refresh" : "reconnect",
      canRefresh,
    );
  }

  if (account.expiresAt.getTime() <= now.getTime() + warningWindowMs) {
    return status(
      account,
      canRefresh ? "refreshing_soon" : "reauth_required",
      canRefresh ? "warning" : "error",
      canRefresh ? "Refreshing soon" : "Reconnect",
      canRefresh
        ? `${label} access token expires soon. SimplePost will refresh it before posting.`
        : `${label} access token expires soon and ${readiness.reason ?? "cannot be refreshed"}. Reconnect this account.`,
      canRefresh ? "refresh" : "reconnect",
      canRefresh,
    );
  }

  if (readiness.supported && !canRefresh) {
    return status(
      account,
      "refresh_unavailable",
      "warning",
      "Refresh unavailable",
      `${label} access token is valid now, but ${readiness.reason ?? "automatic refresh is unavailable"}. Reconnect before it expires.`,
      "reconnect",
      false,
    );
  }

  return status(account, "healthy", "ok", "Active", `${label} credentials are healthy.`, "none", canRefresh);
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    const data = JSON.parse(text) as unknown;
    return isPlainObject(data) ? data : {};
  } catch {
    return {};
  }
}

function providerErrorMessage(data: Record<string, unknown>): string | null {
  const error = data.error;
  if (isPlainObject(error) && typeof error.message === "string") {
    return error.message;
  }
  for (const key of ["error_description", "error", "message"] as const) {
    const value = data[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

async function expectTokenResponse(platform: string, response: Response): Promise<Record<string, unknown>> {
  const data = await parseJsonObject(response);
  if (!response.ok) {
    const providerMessage = providerErrorMessage(data) || response.statusText || "unknown error";
    throw new Error(`${platformLabel(platform)} token refresh failed (${response.status}): ${providerMessage}`);
  }
  return data;
}

function buildRefreshResult(
  account: ConnectedAccount,
  data: Record<string, unknown>,
  now: Date,
  options?: { fallbackExpiresInSec?: number; keepRefreshToken?: boolean },
): TokenRefreshResult {
  const accessToken = typeof data.access_token === "string" ? data.access_token : null;
  if (!accessToken) {
    throw new Error(`${platformLabel(account.platform)} token refresh returned no access token`);
  }

  const expiresIn = secondsField(data, "expires_in") ?? options?.fallbackExpiresInSec;
  return {
    accessToken,
    expiresAt: dateFromSeconds(expiresIn, now) ?? account.expiresAt,
    refreshToken:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : options?.keepRefreshToken
          ? account.refreshToken
          : undefined,
    refreshTokenExpiresAt: getRefreshTokenExpiresAt(data, now),
  };
}

async function refreshX(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  const clientId = getXClientId();
  const clientSecret = getXClientSecret();
  if (!account.refreshToken || !clientId) {
    throw new Error("X refresh token or client ID is missing. Reconnect the X account.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("x", response), now);
}

async function refreshYouTube(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  const clientId = getYouTubeClientId();
  const clientSecret = getYouTubeClientSecret();
  if (!account.refreshToken || !clientId || !clientSecret) {
    throw new Error("YouTube refresh token or Google client credentials are missing. Reconnect the YouTube account.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("youtube", response), now, { keepRefreshToken: true });
}

async function refreshInstagram(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", account.accessToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("instagram", response), now, { keepRefreshToken: true });
}

async function refreshThreads(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", account.accessToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("threads", response), now, { keepRefreshToken: true });
}

async function refreshTikTok(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  if (!account.refreshToken || !process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    throw new Error("TikTok refresh token or client credentials are missing. Reconnect the TikTok account.");
  }

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("tiktok", response), now, { keepRefreshToken: true });
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function buildDpopProof(params: {
  nonce?: string;
  privateJwk: Record<string, unknown>;
  publicJwk: Record<string, unknown>;
  tokenUrl: string;
}): string {
  const privateKey = crypto.createPrivateKey({
    format: "jwk",
    key: params.privateJwk as crypto.JsonWebKey,
  });
  const iat = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    exp: iat + 120,
    htm: "POST",
    htu: params.tokenUrl,
    iat,
    jti: crypto.randomUUID(),
  };
  if (params.nonce) payload.nonce = params.nonce;

  const header = { alg: "ES256", jwk: params.publicJwk, typ: "dpop+jwt" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const derSignature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64UrlEncode(derToRaw(derSignature))}`;
}

async function refreshBluesky(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  const metadata = getTokenMetadata(account);
  const clientId = typeof metadata.clientId === "string" ? metadata.clientId : process.env.BLUESKY_CLIENT_ID || "";
  const tokenUrl = typeof metadata.tokenUrl === "string" ? metadata.tokenUrl : "";
  if (!account.refreshToken || !clientId || !tokenUrl) {
    throw new Error("Bluesky refresh token, client ID, or token URL is missing. Reconnect the Bluesky account.");
  }

  const dpopPublicJwk = isPlainObject(metadata.dpopPublicJwk) ? metadata.dpopPublicJwk : null;
  const dpopPrivateJwk = isPlainObject(metadata.dpopPrivateJwk) ? metadata.dpopPrivateJwk : null;

  const makeRequest = (nonce?: string) => {
    const proof =
      dpopPublicJwk && dpopPrivateJwk
        ? buildDpopProof({ nonce, privateJwk: dpopPrivateJwk, publicJwk: dpopPublicJwk, tokenUrl })
        : null;

    return fetch(tokenUrl, {
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken!,
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(proof ? { DPoP: proof } : {}),
      },
      method: "POST",
      signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
    });
  };

  let response = await makeRequest();
  if (!response.ok) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (nonce) {
      response = await makeRequest(nonce);
    }
  }
  return buildRefreshResult(account, await expectTokenResponse("bluesky", response), now, {
    fallbackExpiresInSec: 3600,
    keepRefreshToken: true,
  });
}

async function refreshLinkedIn(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  if (!account.refreshToken || !process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
    throw new Error("LinkedIn refresh token or client credentials are missing. Reconnect the LinkedIn account.");
  }

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    body: new URLSearchParams({
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("linkedin", response), now, { keepRefreshToken: true });
}

async function refreshPinterest(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  if (!account.refreshToken || !process.env.PINTEREST_CLIENT_ID || !process.env.PINTEREST_CLIENT_SECRET) {
    throw new Error("Pinterest refresh token or client credentials are missing. Reconnect the Pinterest account.");
  }

  const credentials = Buffer.from(`${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`).toString(
    "base64",
  );
  const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  return buildRefreshResult(account, await expectTokenResponse("pinterest", response), now, { keepRefreshToken: true });
}

async function refreshSlack(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  if (!account.refreshToken || !process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    throw new Error("Slack refresh token or client credentials are missing. Reconnect the Slack account.");
  }
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });
  const data = await expectTokenResponse("slack", response);
  // Slack reports errors with HTTP 200 and { ok: false, error } instead of an error status.
  if (data.ok === false) {
    throw new Error(`Slack token refresh failed: ${typeof data.error === "string" ? data.error : "unknown_error"}`);
  }
  return buildRefreshResult(account, data, now, { keepRefreshToken: true });
}

async function refreshPlatformToken(account: ConnectedAccount, now: Date): Promise<TokenRefreshResult> {
  switch (account.platform.toLowerCase()) {
    case "x":
    case "twitter": {
      return await refreshX(account, now);
    }
    case "youtube": {
      return await refreshYouTube(account, now);
    }
    case "instagram": {
      return await refreshInstagram(account, now);
    }
    case "threads": {
      return await refreshThreads(account, now);
    }
    case "tiktok": {
      return await refreshTikTok(account, now);
    }
    case "bluesky": {
      return await refreshBluesky(account, now);
    }
    case "linkedin": {
      return await refreshLinkedIn(account, now);
    }
    case "pinterest": {
      return await refreshPinterest(account, now);
    }
    case "slack": {
      return await refreshSlack(account, now);
    }
    default: {
      throw new Error(`${platformLabel(account.platform)} does not support automatic credential refresh.`);
    }
  }
}

function withRefreshMetadata(
  account: ConnectedAccount,
  now: Date,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const metadata = {
    ...getTokenMetadata(account),
    ...patch,
    lastRefreshAttemptAt: now.toISOString(),
  };

  return metadata as Prisma.InputJsonValue;
}

async function persistRefreshError(account: ConnectedAccount, now: Date, message: string): Promise<void> {
  const tokenMetadata = withRefreshMetadata(account, now, {
    lastRefreshError: message,
    lastRefreshErrorAt: now.toISOString(),
  });

  try {
    // Only the metadata is written: rewriting the (unchanged) tokens here
    // could clobber credentials persisted by a concurrent refresh.
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        tokenMetadata: encryptTokenMetadata(tokenMetadata) ?? undefined,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    log.warn({ accountId: account.id, err: serializeError(error) }, "Failed to persist credential refresh error");
  }
}

async function persistRefreshSuccess(
  account: ConnectedAccount,
  refreshed: TokenRefreshResult,
  now: Date,
): Promise<ConnectedAccount> {
  const tokenMetadata = withRefreshMetadata(account, now, {
    lastRefreshError: null,
    lastRefreshErrorAt: null,
    lastRefreshedAt: now.toISOString(),
    ...(refreshed.refreshTokenExpiresAt
      ? { refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt.toISOString() }
      : {}),
  });
  const refreshToken = refreshed.refreshToken === undefined ? account.refreshToken : refreshed.refreshToken;

  const updated = await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      ...encryptConnectedAccountSecrets({
        accessToken: refreshed.accessToken,
        refreshToken,
        tokenMetadata,
      }),
      expiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    },
    select: { updatedAt: true },
  });

  return {
    ...account,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshToken ?? null,
    tokenMetadata: tokenMetadata as Prisma.JsonValue,
    updatedAt: updated.updatedAt,
  };
}

function shouldRefreshAccount(
  account: ConnectedAccount,
  options: { force?: boolean; minValidityMs: number; now: Date },
): boolean {
  if (options.force) {
    return true;
  }
  if (!account.expiresAt) {
    return !isNonExpiringPlatform(account.platform.toLowerCase());
  }
  return account.expiresAt.getTime() <= options.now.getTime() + options.minValidityMs;
}

function isTokenExpired(account: ConnectedAccount, now: Date): boolean {
  return account.expiresAt !== null && account.expiresAt.getTime() <= now.getTime();
}

function isRefreshCoolingDown(account: ConnectedAccount, now: Date): boolean {
  const lastErrorAt = metadataDate(account, "lastRefreshErrorAt");
  return lastErrorAt !== null && lastErrorAt.getTime() > now.getTime() - FAILED_REFRESH_RETRY_INTERVAL_MS;
}

export async function refreshConnectedAccountIfNeeded(
  account: ConnectedAccount,
  options?: { force?: boolean; minValidityMs?: number; now?: Date; reason?: "post" | "background" | "manual" },
): Promise<RefreshConnectedAccountResult> {
  const now = options?.now ?? new Date();
  const minValidityMs = options?.minValidityMs ?? POST_CREDENTIAL_MIN_VALIDITY_MS;
  const reason = options?.reason ?? "post";
  const currentStatus = getConnectedAccountCredentialStatus(account, { now, warningWindowMs: minValidityMs });

  if (!shouldRefreshAccount(account, { force: options?.force, minValidityMs, now })) {
    return { account, refreshed: false, status: currentStatus };
  }

  // Background sweeps back off after a failed attempt so a permanently broken
  // account isn't retried on every dispatcher run. User-triggered refreshes
  // still retry immediately: a publish is at stake.
  if (reason === "background" && !options?.force && isRefreshCoolingDown(account, now)) {
    return { account, refreshed: false, status: currentStatus };
  }

  // Block the caller only when the token is known to be expired; a refresh
  // failure with a still-valid (or unknown-validity) token fails open so the
  // publish attempt can proceed with the existing token.
  const failure = (message: string): RefreshConnectedAccountResult =>
    isTokenExpired(account, now)
      ? { account, error: message, refreshed: false, refreshError: message, status: currentStatus }
      : { account, refreshed: false, refreshError: message, status: currentStatus };

  if (!currentStatus.canRefresh) {
    log.warn(
      { accountId: account.id, platform: account.platform, reason },
      "Connected account credentials need refresh but cannot be refreshed",
    );
    await persistRefreshError(account, now, currentStatus.message);
    return failure(currentStatus.message);
  }

  try {
    log.info({ accountId: account.id, platform: account.platform, reason }, "Refreshing connected account credentials");
    const refreshed = await refreshPlatformToken(account, now);
    const updatedAccount = await persistRefreshSuccess(account, refreshed, now);
    const refreshedStatus = getConnectedAccountCredentialStatus(updatedAccount, {
      now,
      warningWindowMs: minValidityMs,
    });
    return { account: updatedAccount, refreshed: true, status: refreshedStatus };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.message}. Reconnect the ${platformLabel(account.platform)} account if this persists.`
        : `${platformLabel(account.platform)} token refresh failed. Reconnect this account.`;
    log.warn(
      { accountId: account.id, err: serializeError(error), platform: account.platform, reason },
      "Connected account credential refresh failed",
    );
    await persistRefreshError(account, now, errorMessage);
    return failure(errorMessage);
  }
}

/**
 * Refreshes access tokens that expire within the sweep window so scheduled
 * posts rarely need a just-in-time refresh. Never throws: the dispatcher
 * must not be blocked by credential upkeep.
 */
export async function refreshExpiringConnectedAccounts(options?: {
  limit?: number;
  minValidityMs?: number;
  now?: Date;
}): Promise<RefreshExpiringAccountsResult> {
  const now = options?.now ?? new Date();
  const minValidityMs = options?.minValidityMs ?? SWEEP_CREDENTIAL_MIN_VALIDITY_MS;
  const cutoff = new Date(now.getTime() + minValidityMs);

  let storedAccounts: Awaited<ReturnType<typeof prisma.connectedAccount.findMany>>;
  try {
    storedAccounts = await prisma.connectedAccount.findMany({
      orderBy: { expiresAt: "asc" },
      take: options?.limit ?? DEFAULT_REFRESH_SWEEP_LIMIT,
      where: {
        expiresAt: {
          lte: cutoff,
        },
      },
    });
  } catch (error) {
    log.error({ err: serializeError(error) }, "Credential refresh sweep could not load accounts");
    return { checked: 0, failed: 0, failures: [], refreshed: 0, skipped: 0 };
  }

  let refreshed = 0;
  let skipped = 0;
  const failures: CredentialPublishIssue[] = [];

  const processAccount = async (storedAccount: (typeof storedAccounts)[number]) => {
    try {
      const account = decryptConnectedAccountSecrets(storedAccount);

      // Checked before taking the lock so broken accounts in their retry
      // cooldown cost no extra DB reads; re-checked on fresh data inside
      // refreshConnectedAccountIfNeeded.
      if (isRefreshCoolingDown(account, now)) {
        skipped += 1;
        return;
      }

      const result = await withAccountLock(account.id, async () => {
        const freshAccount = await reloadAccountSecrets(account);
        return await refreshConnectedAccountIfNeeded(freshAccount, {
          minValidityMs,
          now,
          reason: "background",
        });
      });

      if (result.refreshed) {
        refreshed += 1;
      } else if (result.refreshError) {
        failures.push({ accountId: account.id, message: result.refreshError, platform: account.platform });
      } else {
        skipped += 1;
      }
    } catch (error) {
      log.warn(
        { accountId: storedAccount.id, err: serializeError(error), platform: storedAccount.platform },
        "Credential refresh sweep failed for account",
      );
      failures.push({
        accountId: storedAccount.id,
        message: error instanceof Error ? error.message : "Unknown error during credential refresh",
        platform: storedAccount.platform,
      });
    }
  };

  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(REFRESH_SWEEP_CONCURRENCY, storedAccounts.length) }, async () => {
      while (nextIndex < storedAccounts.length) {
        const storedAccount = storedAccounts[nextIndex];
        nextIndex += 1;
        await processAccount(storedAccount);
      }
    }),
  );

  return {
    checked: storedAccounts.length,
    failed: failures.length,
    failures,
    refreshed,
    skipped,
  };
}

export async function getCredentialIssuesForPublishTime(params: {
  accountIds: string[];
  publishAt: Date;
  userId: string;
}): Promise<CredentialPublishIssue[]> {
  const storedAccounts = await prisma.connectedAccount.findMany({
    where: {
      id: { in: params.accountIds },
      userId: params.userId,
    },
  });
  const accounts = storedAccounts.map((account) => decryptConnectedAccountSecrets(account));
  const requiredAtMs = params.publishAt.getTime() + POST_CREDENTIAL_MIN_VALIDITY_MS;

  return accounts.flatMap((account) => {
    const readiness = getRefreshReadiness(account);
    const label = platformLabel(account.platform);
    const refreshTokenExpiresAt = metadataDate(account, "refreshTokenExpiresAt");

    if (refreshTokenExpiresAt && refreshTokenExpiresAt.getTime() <= requiredAtMs) {
      return [
        {
          accountId: account.id,
          message: `${label} refresh token expires before the scheduled publish time. Reconnect this account before scheduling.`,
          platform: account.platform,
        },
      ];
    }

    if (account.expiresAt && account.expiresAt.getTime() <= requiredAtMs && !readiness.ready) {
      return [
        {
          accountId: account.id,
          message: `${label} access token expires before the publish time and ${readiness.reason ?? "cannot be refreshed"}. Reconnect this account before scheduling.`,
          platform: account.platform,
        },
      ];
    }

    return [];
  });
}
