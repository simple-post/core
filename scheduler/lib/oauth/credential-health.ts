import crypto from "node:crypto";

import { derToRaw } from "@simple-post/sdk";

import { createLogger, serializeError } from "@/lib/logger";
import { getBlueskyClientId } from "@/lib/oauth/bluesky-client";
import {
  acquireConnectedAccountCredentialLock,
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS,
} from "@/lib/oauth/connected-account-lock";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
  encryptTokenMetadata,
} from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount, ConnectedAccountCredentialStatus, ConnectedAccountCredentialState } from "@/types";

import type { Prisma, PrismaClient } from "@prisma/client";

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
  tokenMetadataPatch?: Record<string, unknown>;
}

type CredentialPersistenceClient = Pick<PrismaClient, "connectedAccount">;

class TokenRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode: string | null,
    readonly providerSubtype: string | null,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
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
    telegram: "Telegram",
    forem: "DEV/Forem",
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
  return platform === "telegram" || platform === "facebook" || platform === "forem";
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
      const clientId = typeof metadata.clientId === "string" ? metadata.clientId : getBlueskyClientId();
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

function hasStoredPermanentRefreshFailure(account: ConnectedAccount): boolean {
  const metadata = getTokenMetadata(account);
  if (typeof metadata.lastRefreshFailurePermanent === "boolean") {
    return metadata.lastRefreshFailurePermanent;
  }

  // Failures recorded before credentialRefreshBlockedAt existed only contain
  // the rendered provider message. Recognize the permanent responses we used
  // to log so affected accounts become visible immediately after deployment.
  const lastError = typeof metadata.lastRefreshError === "string" ? metadata.lastRefreshError.toLowerCase() : "";
  if (!lastError) {
    return false;
  }

  return (
    [
      "invalid_grant",
      "invalid refresh token",
      "refresh token is invalid",
      "refresh token has expired",
      "refresh token was revoked",
      "token was invalid",
      "session has been invalidated",
    ].some((fragment) => lastError.includes(fragment)) ||
    // Google's old response parser discarded `invalid_grant` and retained
    // only the unhelpful error_description shown in the production logs.
    lastError.includes("youtube token refresh failed (400): bad request")
  );
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

  if (account.credentialRefreshBlockedAt || hasStoredPermanentRefreshFailure(account)) {
    return status(
      account,
      "reauth_required",
      "error",
      "Reconnect",
      `${label} rejected the stored credentials. Reconnect this account before posting.`,
      "reconnect",
      false,
    );
  }

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
    // LinkedIn commonly issues access tokens without a refresh token. The
    // account is still fully usable until its recorded expiry, and the expiry
    // warning above will ask the user to reconnect at the appropriate time.
    // A stored refresh token with missing client credentials is a server
    // misconfiguration instead and falls through to the generic warning.
    if (platform === "linkedin" && !account.refreshToken) {
      return status(
        account,
        "healthy",
        "ok",
        "Active",
        `${label} credentials are active. SimplePost will ask you to reconnect before they expire.`,
        "none",
        false,
      );
    }

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

function providerErrorDetails(data: Record<string, unknown>): {
  code: string | null;
  message: string | null;
  subtype: string | null;
} {
  const error = data.error;
  const objectMessage = isPlainObject(error) && typeof error.message === "string" ? error.message : null;
  const objectCode =
    isPlainObject(error) && (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : isPlainObject(error) && typeof error.type === "string"
        ? error.type
        : null;
  const code = typeof error === "string" && error ? error : objectCode;
  const description =
    typeof data.error_description === "string" && data.error_description ? data.error_description : null;
  const topLevelMessage = typeof data.message === "string" && data.message ? data.message : null;
  const subtype = typeof data.error_subtype === "string" && data.error_subtype ? data.error_subtype : null;

  return {
    code,
    message: objectMessage ?? description ?? topLevelMessage ?? code,
    subtype,
  };
}

function isPermanentRefreshRejection(status: number, code: string | null, message: string): boolean {
  if (status !== 400 && status !== 401) {
    return false;
  }

  const normalizedCode = code?.toLowerCase().replaceAll("-", "_") ?? "";
  if (["invalid_grant", "invalid_token", "invalid_refresh_token"].includes(normalizedCode)) {
    return true;
  }

  const normalizedMessage = message.toLowerCase();
  return [
    "invalid refresh token",
    "refresh token is invalid",
    "refresh token has expired",
    "refresh token was revoked",
    "token was invalid",
    "session has been invalidated",
  ].some((fragment) => normalizedMessage.includes(fragment));
}

async function expectTokenResponse(platform: string, response: Response): Promise<Record<string, unknown>> {
  const data = await parseJsonObject(response);
  if (!response.ok) {
    const details = providerErrorDetails(data);
    const providerMessage = details.message || response.statusText || "unknown error";
    const combinedMessage =
      details.code && details.code.toLowerCase() !== providerMessage.toLowerCase()
        ? `${details.code}: ${providerMessage}`
        : providerMessage;
    throw new TokenRefreshError(
      `${platformLabel(platform)} token refresh failed (${response.status}): ${combinedMessage}`,
      response.status,
      details.code,
      details.subtype,
      isPermanentRefreshRejection(response.status, details.code, combinedMessage),
    );
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
  const clientId = typeof metadata.clientId === "string" ? metadata.clientId : getBlueskyClientId();
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

  const storedNonce = typeof metadata.tokenDpopNonce === "string" ? metadata.tokenDpopNonce : undefined;
  let response = await makeRequest(storedNonce);
  if (!response.ok) {
    const nonce = response.headers.get("DPoP-Nonce");
    const challenge = providerErrorDetails(await parseJsonObject(response.clone()));
    // A DPoP-Nonce header can accompany unrelated OAuth errors. Reusing a
    // single-use refresh token is safe only for an explicit nonce challenge.
    if (nonce && challenge.code?.toLowerCase() === "use_dpop_nonce") {
      response = await makeRequest(nonce);
    }
  }
  const refreshed = buildRefreshResult(account, await expectTokenResponse("bluesky", response), now, {
    fallbackExpiresInSec: 3600,
    keepRefreshToken: true,
  });
  const nextNonce = response.headers.get("DPoP-Nonce");
  if (nextNonce) {
    refreshed.tokenMetadataPatch = { tokenDpopNonce: nextNonce };
  }
  return refreshed;
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

interface RefreshFailureDetails {
  permanent: boolean;
  providerCode?: string | null;
  providerStatus?: number | null;
  providerSubtype?: string | null;
}

async function persistRefreshError(
  client: CredentialPersistenceClient,
  account: ConnectedAccount,
  now: Date,
  message: string,
  details: RefreshFailureDetails,
): Promise<ConnectedAccount | null> {
  const tokenMetadata = withRefreshMetadata(account, now, {
    lastRefreshError: message,
    lastRefreshErrorAt: now.toISOString(),
    lastRefreshErrorCode: details.providerCode ?? null,
    lastRefreshErrorStatus: details.providerStatus ?? null,
    lastRefreshErrorSubtype: details.providerSubtype ?? null,
    lastRefreshFailurePermanent: details.permanent,
  });

  const updatedAt = new Date();
  const credentialRefreshBlockedAt = details.permanent ? now : null;
  const credentialRefreshRetryAt = details.permanent
    ? null
    : new Date(now.getTime() + FAILED_REFRESH_RETRY_INTERVAL_MS);
  const result = await client.connectedAccount.updateMany({
    where: { id: account.id, updatedAt: account.updatedAt },
    data: {
      credentialRefreshBlockedAt,
      credentialRefreshRetryAt,
      tokenMetadata: encryptTokenMetadata(tokenMetadata) ?? undefined,
      updatedAt,
    },
  });
  if (result.count !== 1) {
    return null;
  }

  return {
    ...account,
    credentialRefreshBlockedAt,
    credentialRefreshRetryAt,
    tokenMetadata: tokenMetadata as Prisma.JsonValue,
    updatedAt,
  };
}

async function persistRefreshSuccess(
  client: CredentialPersistenceClient,
  account: ConnectedAccount,
  refreshed: TokenRefreshResult,
  now: Date,
): Promise<ConnectedAccount | null> {
  const tokenMetadata = withRefreshMetadata(account, now, {
    ...refreshed.tokenMetadataPatch,
    lastRefreshError: null,
    lastRefreshErrorAt: null,
    lastRefreshErrorCode: null,
    lastRefreshErrorStatus: null,
    lastRefreshErrorSubtype: null,
    lastRefreshFailurePermanent: false,
    lastRefreshedAt: now.toISOString(),
    ...(refreshed.refreshTokenExpiresAt
      ? { refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt.toISOString() }
      : {}),
  });
  const refreshToken = refreshed.refreshToken === undefined ? account.refreshToken : refreshed.refreshToken;
  const updatedAt = new Date();
  const result = await client.connectedAccount.updateMany({
    where: { id: account.id, updatedAt: account.updatedAt },
    data: {
      ...encryptConnectedAccountSecrets({
        accessToken: refreshed.accessToken,
        refreshToken,
        tokenMetadata,
      }),
      credentialRefreshBlockedAt: null,
      credentialRefreshRetryAt: null,
      expiresAt: refreshed.expiresAt,
      updatedAt,
    },
  });
  if (result.count !== 1) {
    return null;
  }

  return {
    ...account,
    accessToken: refreshed.accessToken,
    credentialRefreshBlockedAt: null,
    credentialRefreshRetryAt: null,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshToken ?? null,
    tokenMetadata: tokenMetadata as Prisma.JsonValue,
    updatedAt,
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
  if (account.credentialRefreshBlockedAt) {
    return true;
  }
  if (account.credentialRefreshRetryAt) {
    return account.credentialRefreshRetryAt.getTime() > now.getTime();
  }

  // Backwards compatibility for failures recorded before queryable retry
  // fields were introduced.
  const lastErrorAt = metadataDate(account, "lastRefreshErrorAt");
  return lastErrorAt !== null && lastErrorAt.getTime() > now.getTime() - FAILED_REFRESH_RETRY_INTERVAL_MS;
}

async function loadConnectedAccount(
  client: CredentialPersistenceClient,
  accountId: string,
): Promise<ConnectedAccount | null> {
  const stored = await client.connectedAccount.findUnique({ where: { id: accountId } });
  return stored ? decryptConnectedAccountSecrets(stored) : null;
}

function refreshFailureResult(
  account: ConnectedAccount,
  status: ConnectedAccountCredentialStatus,
  now: Date,
  message: string,
): RefreshConnectedAccountResult {
  return isTokenExpired(account, now)
    ? { account, error: message, refreshed: false, refreshError: message, status }
    : { account, refreshed: false, refreshError: message, status };
}

async function refreshConnectedAccountWhileLocked(
  client: CredentialPersistenceClient,
  account: ConnectedAccount,
  options: {
    force?: boolean;
    minValidityMs: number;
    now: Date;
    reason: "post" | "background" | "manual";
  },
): Promise<RefreshConnectedAccountResult> {
  const { minValidityMs, now, reason } = options;
  const currentStatus = getConnectedAccountCredentialStatus(account, { now, warningWindowMs: minValidityMs });

  // Another request may have refreshed or reconnected this account while this
  // request was waiting for the PostgreSQL advisory lock.
  if (!shouldRefreshAccount(account, { force: options.force, minValidityMs, now })) {
    return { account, refreshed: false, status: currentStatus };
  }

  if (reason === "background" && !options.force && isRefreshCoolingDown(account, now)) {
    return { account, refreshed: false, status: currentStatus };
  }

  if (!currentStatus.canRefresh) {
    const message = currentStatus.message;
    if (account.credentialRefreshBlockedAt) {
      return refreshFailureResult(account, currentStatus, now, message);
    }

    log.warn(
      { accountId: account.id, platform: account.platform, reason },
      "Connected account credentials need refresh but cannot be refreshed",
    );
    const persisted = await persistRefreshError(client, account, now, message, {
      permanent: hasStoredPermanentRefreshFailure(account),
    });
    const failedAccount = persisted ?? (await loadConnectedAccount(client, account.id)) ?? account;
    const failedStatus = getConnectedAccountCredentialStatus(failedAccount, { now, warningWindowMs: minValidityMs });
    return refreshFailureResult(failedAccount, failedStatus, now, message);
  }

  let refreshed: TokenRefreshResult;
  try {
    log.info({ accountId: account.id, platform: account.platform, reason }, "Refreshing connected account credentials");
    refreshed = await refreshPlatformToken(account, now);
  } catch (error) {
    const tokenError = error instanceof TokenRefreshError ? error : null;
    const errorMessage =
      error instanceof Error
        ? `${error.message}. Reconnect the ${platformLabel(account.platform)} account if this persists.`
        : `${platformLabel(account.platform)} token refresh failed. Reconnect this account.`;
    log.warn(
      {
        accountId: account.id,
        err: serializeError(error),
        permanent: tokenError?.permanent ?? false,
        platform: account.platform,
        providerCode: tokenError?.providerCode,
        providerStatus: tokenError?.status,
        providerSubtype: tokenError?.providerSubtype,
        reason,
      },
      "Connected account credential refresh failed",
    );

    const persisted = await persistRefreshError(client, account, now, errorMessage, {
      permanent: tokenError?.permanent ?? false,
      providerCode: tokenError?.providerCode,
      providerStatus: tokenError?.status,
      providerSubtype: tokenError?.providerSubtype,
    });
    const failedAccount = persisted ?? (await loadConnectedAccount(client, account.id)) ?? account;
    const failedStatus = getConnectedAccountCredentialStatus(failedAccount, { now, warningWindowMs: minValidityMs });
    return refreshFailureResult(failedAccount, failedStatus, now, errorMessage);
  }

  const updatedAccount = await persistRefreshSuccess(client, account, refreshed, now);
  if (!updatedAccount) {
    // A reconnect/delete won the compare-and-swap. Never overwrite it with a
    // token produced from the stale session.
    const latestAccount = await loadConnectedAccount(client, account.id);
    if (latestAccount) {
      return {
        account: latestAccount,
        refreshed: false,
        status: getConnectedAccountCredentialStatus(latestAccount, { now, warningWindowMs: minValidityMs }),
      };
    }
    const message = `${platformLabel(account.platform)} account changed while its credentials were refreshing.`;
    return refreshFailureResult(account, currentStatus, now, message);
  }

  const refreshedStatus = getConnectedAccountCredentialStatus(updatedAccount, {
    now,
    warningWindowMs: minValidityMs,
  });
  return { account: updatedAccount, refreshed: true, status: refreshedStatus };
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

  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireConnectedAccountCredentialLock(transaction, account.id);
      const freshAccount = await loadConnectedAccount(transaction, account.id);
      if (!freshAccount) {
        const message = `${platformLabel(account.platform)} account no longer exists.`;
        return refreshFailureResult(account, currentStatus, now, message);
      }
      return await refreshConnectedAccountWhileLocked(transaction, freshAccount, {
        force: options?.force,
        minValidityMs,
        now,
        reason,
      });
    }, CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS);
  } catch (error) {
    const errorMessage = `${platformLabel(account.platform)} credentials could not be refreshed safely. Try again shortly.`;
    log.error(
      { accountId: account.id, err: serializeError(error), platform: account.platform, reason },
      "Connected account credential refresh transaction failed",
    );
    return refreshFailureResult(account, currentStatus, now, errorMessage);
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
        credentialRefreshBlockedAt: null,
        OR: [{ credentialRefreshRetryAt: null }, { credentialRefreshRetryAt: { lte: now } }],
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

    if (account.credentialRefreshBlockedAt || hasStoredPermanentRefreshFailure(account)) {
      return [
        {
          accountId: account.id,
          message: `${label} rejected the stored credentials. Reconnect this account before scheduling.`,
          platform: account.platform,
        },
      ];
    }

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
