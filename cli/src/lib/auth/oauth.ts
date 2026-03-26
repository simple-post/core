import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

import selfsigned from "selfsigned";

import { DEFAULT_OAUTH_TIMEOUT_MS } from "../constants.js";
import { getAccountPlatformConfig, type AccountPlatform, type EmbeddedOAuthAppConfig } from "../account/platforms.js";
import { openExternalUrl } from "../ux/browser.js";

import type { AuthProvider, AuthProviderContext, OAuthLoginFlags } from "./provider.js";
import type { CliConfigV1, OAuthAccountSecretPayload, StoredAccount } from "../types.js";

export interface ResolvedOAuthAppConfig extends EmbeddedOAuthAppConfig {
  clientSecret?: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  expiresAt?: number;
  raw?: unknown;
  refreshToken?: string;
  scope?: string;
  tokenMetadata?: Record<string, unknown>;
}

export interface OAuthLoginCompletion {
  displayName?: string;
  message?: string;
  secretPayload?: Partial<OAuthAccountSecretPayload>;
  settings?: Record<string, unknown>;
  userId: string;
  username?: string;
}

export interface OAuthAuthorizationSession {
  appConfig: ResolvedOAuthAppConfig;
  authUrl: string;
  codeVerifier?: string;
  sessionData?: Record<string, unknown>;
  state: string;
}

export interface OAuthProviderDependencies {
  createAccountSecretRef?: () => string;
  createState?: () => string;
  resolveCallbackUrl?: typeof resolveOAuthCallbackUrl;
}

interface OAuthProviderDefinition {
  completeLogin(input: {
    appConfig: ResolvedOAuthAppConfig;
    context: AuthProviderContext;
    flags: OAuthLoginFlags;
    sessionData?: Record<string, unknown>;
    tokenSet: OAuthTokenSet;
  }): Promise<OAuthLoginCompletion>;
  exchangeCode?: (input: {
    appConfig: ResolvedOAuthAppConfig;
    code: string;
    codeVerifier?: string;
    platform: AccountPlatform;
    sessionData?: Record<string, unknown>;
  }) => Promise<OAuthTokenSet>;
  prepare?: (input: {
    appConfig: ResolvedOAuthAppConfig;
    context: AuthProviderContext;
    flags: OAuthLoginFlags;
  }) => Promise<void>;
  startAuthorization?: (input: {
    appConfig: ResolvedOAuthAppConfig;
    context: AuthProviderContext;
    flags: OAuthLoginFlags;
    platform: AccountPlatform;
  }) => Promise<OAuthAuthorizationSession>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (isObject(data)) {
    // TikTok OAuth: { error: "invalid_request", error_description: "...", log_id }
    const ttDesc = typeof data.error_description === "string" ? data.error_description : undefined;
    const ttCode = typeof data.error === "string" ? data.error : undefined;
    if (ttDesc && ttCode) {
      return `${ttCode}: ${ttDesc}`;
    }
    if (ttDesc) {
      return ttDesc;
    }

    // Facebook/Meta returns { error: { message: "...", type: "...", code: N } }
    if (isObject(data.error)) {
      const nested = data.error;
      const msg = typeof nested.message === "string" ? nested.message : undefined;
      const type = typeof nested.type === "string" ? nested.type : undefined;
      if (msg) {
        return type ? `${type}: ${msg}` : msg;
      }
    }

    // Instagram OAuth: { error_type, code, error_message }
    const igMsg = typeof data.error_message === "string" ? data.error_message : undefined;
    const igType = typeof data.error_type === "string" ? data.error_type : undefined;
    if (igMsg) {
      return igType ? `${igType}: ${igMsg}` : igMsg;
    }

    for (const key of ["error_description", "detail", "message", "title", "error"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return fallback;
}

export async function fetchJson<T>(input: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(input, init);
  const raw = await response.text();
  const data = raw ? (JSON.parse(raw) as unknown) : undefined;

  if (!response.ok) {
    const message = extractErrorMessage(data, response.statusText);
    throw new Error(`${label} failed (${response.status}): ${message}`);
  }

  return data as T;
}

export function ensureLoopbackRedirectUri(redirectUri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error(`Invalid redirect URI: ${redirectUri}`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  const isHttp = parsed.protocol === "http:";
  const isHttps = parsed.protocol === "https:";
  if ((!isHttp && !isHttps) || !isLoopback) {
    throw new Error(
      "OAuth redirect URI must be a loopback URL such as http://127.0.0.1:5000/oauth/callback or https://localhost:5000/oauth/callback.",
    );
  }
  if (isHttps && host !== "localhost") {
    throw new Error("HTTPS OAuth redirect URI must use localhost (not 127.0.0.1).");
  }

  return parsed;
}

export async function generatePkcePair(options?: {
  challengeEncoding?: "base64url" | "hex";
}): Promise<{ codeChallenge: string; codeVerifier: string }> {
  const encoding = options?.challengeEncoding ?? "base64url";
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge =
    encoding === "hex" ? Buffer.from(digest).toString("hex") : Buffer.from(digest).toString("base64url");
  return { codeChallenge, codeVerifier };
}

function getOAuthTimeoutMs(): number {
  const raw = process.env.SIMPLE_POST_OAUTH_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_OAUTH_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OAUTH_TIMEOUT_MS;
}

export function buildAuthorizationUrl(options: {
  appConfig: ResolvedOAuthAppConfig;
  codeChallenge?: string;
  /** OpenID Connect: required by Meta for OIDC authorization code + PKCE login. */
  nonce?: string;
  state: string;
}): string {
  const url = new URL(options.appConfig.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(options.appConfig.clientIdAuthorizeParameter ?? "client_id", options.appConfig.clientId);
  url.searchParams.set("redirect_uri", options.appConfig.redirectUri);
  url.searchParams.set(
    "scope",
    options.appConfig.scopes.join(options.appConfig.scopeSeparator === "," ? "," : " "),
  );
  url.searchParams.set("state", options.state);

  if (options.nonce) {
    url.searchParams.set("nonce", options.nonce);
  }

  if (options.codeChallenge) {
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  for (const [key, value] of Object.entries(options.appConfig.extraAuthorizationParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function startDefaultAuthorization(
  _platform: AccountPlatform,
  appConfig: ResolvedOAuthAppConfig,
  state?: string,
): Promise<OAuthAuthorizationSession> {
  const pkcePair = appConfig.pkce
    ? await generatePkcePair({ challengeEncoding: appConfig.pkceChallengeEncoding })
    : undefined;
  const resolvedState = state ?? crypto.randomUUID();

  return {
    appConfig,
    authUrl: buildAuthorizationUrl({
      appConfig,
      ...(pkcePair ? { codeChallenge: pkcePair.codeChallenge } : {}),
      state: resolvedState,
    }),
    ...(pkcePair ? { codeVerifier: pkcePair.codeVerifier } : {}),
    state: resolvedState,
  };
}

export function parseOAuthCallbackUrl(callbackUrl: string, expectedState: string, redirectUri: string): string {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("The callback URL must be a full URL copied from the browser.");
  }

  const expected = ensureLoopbackRedirectUri(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new Error("The callback URL does not match the configured redirect URI.");
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description");
    throw new Error(description ? `${oauthError}: ${description}` : oauthError);
  }

  const state = url.searchParams.get("state");
  if (!state || state !== expectedState) {
    throw new Error("OAuth state validation failed. Please try again.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("The callback URL did not include an authorization code.");
  }

  return code;
}

function createRequestHandler(
  parsed: URL,
  onCallback: (requestUrl: string) => void,
): (request: http.IncomingMessage, response: http.ServerResponse) => void {
  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", parsed.origin);

    if (requestUrl.pathname !== parsed.pathname) {
      response.statusCode = 404;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("This callback path does not match the active SimplePost login flow.");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      "<html><body><h1>SimplePost connected.</h1><p>You can close this browser tab and return to the terminal.</p></body></html>",
    );

    onCallback(requestUrl.toString());
  };
}

interface CallbackServer {
  close(): void;
  whenCallback: Promise<string>;
  whenListening: Promise<void>;
}

async function startCallbackServer(redirectUri: string, timeoutMs: number): Promise<CallbackServer> {
  const parsed = ensureLoopbackRedirectUri(redirectUri);
  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost === "localhost" ? "127.0.0.1" : rawHost === "[::1]" ? "::1" : rawHost;
  const useHttps = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : useHttps ? 443 : 80;

  let tlsOptions: { key: string; cert: string } | undefined;
  if (useHttps) {
    const attrs = [{ name: "commonName", value: "localhost" }];
    const notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const generated = await selfsigned.generate(attrs, {
      algorithm: "sha256",
      notAfterDate: notAfter,
      extensions: [
        { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
      ],
    });
    tlsOptions = { key: generated.private, cert: generated.cert };
  }

  let resolveListening!: () => void;
  const whenListening = new Promise<void>((r) => { resolveListening = r; });

  let resolveCallback!: (url: string) => void;
  let rejectCallback!: (err: Error) => void;
  const whenCallback = new Promise<string>((res, rej) => { resolveCallback = res; rejectCallback = rej; });

  let settled = false;
  const handler = createRequestHandler(parsed, (url) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveCallback(url);
  });

  const server = useHttps && tlsOptions
    ? https.createServer(tlsOptions, handler as (req: http.IncomingMessage, res: http.ServerResponse) => void)
    : http.createServer(handler);

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      server.close(() => undefined);
      rejectCallback(new Error("OAuth callback timed out."));
    }
  }, timeoutMs);

  server.once("error", (error: NodeJS.ErrnoException) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close(() => undefined);
    if (error.code === "EADDRINUSE") {
      rejectCallback(new Error(
        `The redirect URI port is already in use (${parsed.origin}). Free that port or use --redirect-uri with a different loopback port.`,
      ));
    } else {
      rejectCallback(new Error(`Failed to listen for the OAuth callback: ${error.message}`));
    }
  });

  server.listen(port, host, () => resolveListening());

  return {
    close() {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
      }
      server.close(() => undefined);
    },
    whenCallback,
    whenListening,
  };
}

/** Brief wait for the loopback callback before offering the paste-URL fallback. */
const PASTE_PROMPT_DELAY_MS = 2_000;

export async function resolveOAuthCallbackUrl(
  context: AuthProviderContext,
  flags: OAuthLoginFlags,
  authUrl: string,
  redirectUri: string,
  platformLabel: string,
): Promise<string> {
  if (flags.callbackUrl) {
    return flags.callbackUrl;
  }

  const callbackServer = await startCallbackServer(redirectUri, getOAuthTimeoutMs());
  await callbackServer.whenListening;

  context.prompt.log("");
  context.prompt.log(`Open this URL in your browser to authorize ${platformLabel}:`);
  context.prompt.log(authUrl);
  context.prompt.log("");

  if (!flags.noBrowser) {
    try {
      await openExternalUrl(authUrl);
    } catch (error: unknown) {
      context.prompt.log(`Could not open a browser automatically: ${error instanceof Error ? error.message : String(error)}`);
      context.prompt.log("Open the URL above manually.");
    }
  } else {
    context.prompt.log("Automatic browser launch disabled. Open the URL above manually.");
  }

  context.prompt.log("Waiting for OAuth callback...");

  if (!context.prompt.interactive) {
    try {
      return await callbackServer.whenCallback;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} Re-run with --callback-url to provide the final callback URL explicitly.`);
    } finally {
      callbackServer.close();
    }
  }

  // Wrap the server callback so rejections (timeouts) don't crash — they
  // become a sentinel value we can check instead.
  const serverResult = callbackServer.whenCallback
    .then((url) => ({ source: "server" as const, url }))
    .catch(() => ({ source: "server-failed" as const }));

  // Wait up to PASTE_PROMPT_DELAY_MS for the callback to arrive automatically.
  // If it does, return immediately. Otherwise show the paste prompt.
  const earlyResult = await Promise.race([
    serverResult,
    new Promise<{ source: "delay" }>((r) => setTimeout(() => r({ source: "delay" }), PASTE_PROMPT_DELAY_MS)),
  ]);

  if (earlyResult.source === "server") {
    callbackServer.close();
    return earlyResult.url;
  }

  context.prompt.log("");
  context.prompt.log("If the browser does not return to the CLI automatically, paste the full callback URL from the address bar.");
  context.prompt.log("");

  for (;;) {
    const result = await Promise.race([
      serverResult,
      context.prompt.text("Paste callback URL (or Enter to keep waiting)", { required: false }).then((url) => ({ source: "paste" as const, url })),
    ]);

    if (result.source === "server") {
      callbackServer.close();
      return result.url;
    }

    if (result.source === "paste") {
      const pasted = result.url.trim();
      if (pasted) {
        callbackServer.close();
        return pasted;
      }
    }

    if (result.source === "server-failed") {
      context.prompt.log("Callback server timed out. Paste the callback URL from your browser.");
      return await context.prompt.text("Callback URL", { required: true });
    }

    context.prompt.log("Still waiting for callback...");
  }
}

function getClientIdOverrideEnvVar(platform: AccountPlatform): string {
  return `SIMPLE_POST_${platform.toUpperCase()}_CLIENT_ID`;
}

function getRedirectOverrideEnvVar(platform: AccountPlatform, appConfig: EmbeddedOAuthAppConfig): string {
  return appConfig.redirectUriEnvVar ?? `SIMPLE_POST_${platform.toUpperCase()}_REDIRECT_URI`;
}

export function resolveOAuthAppInputs(
  platform: AccountPlatform,
  flags: OAuthLoginFlags,
  embeddedAppConfig: EmbeddedOAuthAppConfig,
): ResolvedOAuthAppConfig {
  const clientIdEnvVar = getClientIdOverrideEnvVar(platform);
  const clientId = process.env[clientIdEnvVar] ?? embeddedAppConfig.clientId;
  if (!clientId) {
    const platformName = getAccountPlatformConfig(platform).displayName;
    if (embeddedAppConfig.clientSecretRequired) {
      const secretEnvVar = embeddedAppConfig.clientSecretEnvVar ?? `SIMPLE_POST_${platform.toUpperCase()}_CLIENT_SECRET`;
      throw new Error(
        `${platformName} does not allow apps to share public OAuth credentials, so you need to register your own ${platformName} developer app.\n\n` +
        `Set these environment variables before connecting:\n` +
        `  ${clientIdEnvVar}      your app's client ID\n` +
        `  ${secretEnvVar}  your app's client secret`,
      );
    }
    throw new Error(`This CLI build does not embed a ${platformName} OAuth client ID. Set ${clientIdEnvVar} in your environment.`);
  }

  const redirectUri =
    flags.redirectUri ??
    process.env[getRedirectOverrideEnvVar(platform, embeddedAppConfig)] ??
    embeddedAppConfig.redirectUri;
  ensureLoopbackRedirectUri(redirectUri);

  const clientSecret =
    embeddedAppConfig.clientSecret ??
    (embeddedAppConfig.clientSecretEnvVar ? process.env[embeddedAppConfig.clientSecretEnvVar] : undefined);

  if (embeddedAppConfig.clientSecretRequired && !clientSecret) {
    const secretEnvVar = embeddedAppConfig.clientSecretEnvVar ?? `SIMPLE_POST_${platform.toUpperCase()}_CLIENT_SECRET`;
    throw new Error(
      `${getAccountPlatformConfig(platform).displayName} requires a client secret for OAuth token exchange.\n\n` +
      `Set ${secretEnvVar} in your environment (found in your developer app settings).`,
    );
  }

  return {
    ...embeddedAppConfig,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    redirectUri,
  };
}

export async function exchangeAuthorizationCode(input: {
  appConfig: ResolvedOAuthAppConfig;
  code: string;
  codeVerifier?: string;
  platform: AccountPlatform;
  sessionData?: Record<string, unknown>;
}): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.appConfig.redirectUri,
  });

  const tokenAuthMethod = input.appConfig.tokenAuthMethod ?? "none";
  if (tokenAuthMethod !== "basic") {
    body.set(input.appConfig.clientIdTokenParameter ?? "client_id", input.appConfig.clientId);
  }

  if (input.codeVerifier) {
    body.set("code_verifier", input.codeVerifier);
  }

  if (input.appConfig.clientSecret && tokenAuthMethod === "client_secret_post") {
    body.set("client_secret", input.appConfig.clientSecret);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (tokenAuthMethod === "basic") {
    if (!input.appConfig.clientSecret) {
      throw new Error(
        `Connecting ${getAccountPlatformConfig(input.platform).displayName} requires ${input.appConfig.clientSecretEnvVar} in the environment for token exchange.`,
      );
    }
    headers.Authorization = `Basic ${Buffer.from(`${input.appConfig.clientId}:${input.appConfig.clientSecret}`).toString("base64")}`;
  }

  const response = await fetchJson<Record<string, unknown>>(
    input.appConfig.tokenUrl,
    {
      method: "POST",
      headers,
      body,
    },
    `${getAccountPlatformConfig(input.platform).displayName} token exchange`,
  );

  const accessToken = typeof response.access_token === "string" ? response.access_token : undefined;
  if (!accessToken) {
    const detail = extractErrorMessage(response, "no access_token in response body");
    throw new Error(
      `${getAccountPlatformConfig(input.platform).displayName} token exchange failed: ${detail}`,
    );
  }

  const expiresIn = typeof response.expires_in === "number" ? response.expires_in : undefined;
  return {
    accessToken,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    raw: response,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : undefined,
    scope: typeof response.scope === "string" ? response.scope : undefined,
  };
}

function validateAlias(alias: string): string {
  const normalized = alias.trim();
  if (!normalized) {
    throw new Error("Account alias cannot be empty.");
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error("Account alias may contain only letters, numbers, dots, underscores, and dashes.");
  }

  return normalized;
}

function createDefaultAlias(platform: AccountPlatform, preferredAlias?: string): string {
  const normalized = preferredAlias
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `${platform}-account`;
}

export async function resolveStoredAccountAlias(
  prompt: AuthProviderContext["prompt"],
  accounts: StoredAccount[],
  platform: AccountPlatform,
  userId: string,
  preferredAlias: string | undefined,
  requestedAlias?: string,
): Promise<string> {
  const existingByUserId = accounts.find((account) => account.userId === userId);
  const defaultAlias = existingByUserId?.alias ?? createDefaultAlias(platform, preferredAlias);
  const alias = requestedAlias
    ? requestedAlias
    : prompt.interactive
      ? await prompt.text("Account alias", { defaultValue: defaultAlias, required: true })
      : defaultAlias;

  const normalized = validateAlias(alias);
  const existingByAlias = accounts.find((account) => account.alias === normalized);
  if (existingByAlias && existingByAlias.userId !== userId) {
    throw new Error(`Another ${getAccountPlatformConfig(platform).displayName} account is already stored as "${normalized}". Choose a different alias.`);
  }

  return normalized;
}

export class OAuthAccountProvider implements AuthProvider<OAuthLoginFlags> {
  public readonly platform: AccountPlatform;

  public constructor(
    platform: AccountPlatform,
    private readonly definition: OAuthProviderDefinition,
    private readonly dependencies?: OAuthProviderDependencies,
  ) {
    this.platform = platform;
  }

  public async login(flags: OAuthLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const embeddedAppConfig = getAccountPlatformConfig(this.platform).oauthApp;
    if (!embeddedAppConfig) {
      throw new Error(`${getAccountPlatformConfig(this.platform).displayName} does not use OAuth. Use the platform-specific auth provider.`);
    }
    const appInputs = resolveOAuthAppInputs(this.platform, flags, embeddedAppConfig);

    await this.definition.prepare?.({
      appConfig: appInputs,
      context,
      flags,
    });

    const authorization = await (this.definition.startAuthorization
      ? this.definition.startAuthorization({
          appConfig: appInputs,
          context,
          flags,
          platform: this.platform,
        })
      : startDefaultAuthorization(this.platform, appInputs, this.dependencies?.createState?.()));

    const callbackUrl = await (this.dependencies?.resolveCallbackUrl ?? resolveOAuthCallbackUrl)(
      context,
      flags,
      authorization.authUrl,
      authorization.appConfig.redirectUri,
      getAccountPlatformConfig(this.platform).displayName,
    );
    const code = parseOAuthCallbackUrl(callbackUrl, authorization.state, authorization.appConfig.redirectUri);
    const tokenSet = await (this.definition.exchangeCode ?? exchangeAuthorizationCode)({
      appConfig: authorization.appConfig,
      code,
      codeVerifier: authorization.codeVerifier,
      platform: this.platform,
      sessionData: authorization.sessionData,
    });
    const completion = await this.definition.completeLogin({
      appConfig: authorization.appConfig,
      context,
      flags,
      sessionData: authorization.sessionData,
      tokenSet,
    });

    const alias = await resolveStoredAccountAlias(
      context.prompt,
      context.config[this.platform].accounts,
      this.platform,
      completion.userId,
      completion.username ?? completion.displayName,
      flags.alias,
    );

    const existingAccount = context.config[this.platform].accounts.find((account) => account.userId === completion.userId);
    const now = new Date().toISOString();
    const secretRef =
      existingAccount?.secretRef ??
      `${this.platform}-account-${this.dependencies?.createAccountSecretRef?.() ?? crypto.randomUUID()}`;

    const updatedAccounts = context.config[this.platform].accounts.filter((account) => account.userId !== completion.userId);
    updatedAccounts.push({
      alias,
      connectedAt: existingAccount?.connectedAt ?? now,
      displayName: completion.displayName,
      secretRef,
      ...(completion.settings ? { settings: completion.settings } : {}),
      updatedAt: now,
      userId: completion.userId,
      ...(completion.username ? { username: completion.username } : {}),
    });
    updatedAccounts.sort((left, right) => left.alias.localeCompare(right.alias));

    const tokenMetadata = {
      clientId: authorization.appConfig.clientId,
      ...(tokenSet.tokenMetadata ?? {}),
      ...(completion.secretPayload?.tokenMetadata ?? {}),
    };

    const secretPayload = {
      accessToken: tokenSet.accessToken,
      ...(tokenSet.refreshToken ? { refreshToken: tokenSet.refreshToken } : {}),
      ...(typeof tokenSet.expiresAt === "number" ? { expiresAt: tokenSet.expiresAt } : {}),
      ...(completion.secretPayload ?? {}),
      ...(Object.keys(tokenMetadata).length > 0 ? { tokenMetadata } : {}),
    } satisfies OAuthAccountSecretPayload;

    await context.secretStore.write(secretRef, secretPayload);

    const handle = completion.username ? ` @${completion.username}` : "";
    context.prompt.log(
      completion.message ?? `Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}"${handle}.`,
    );

    return {
      ...context.config,
      [this.platform]: {
        accounts: updatedAccounts,
      },
    };
  }
}
