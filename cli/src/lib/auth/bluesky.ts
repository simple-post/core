import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { derToRaw } from "@simple-post/sdk";

import { OAuthAccountProvider, fetchJson, generatePkcePair } from "./oauth.js";

import type {
  OAuthAuthorizationSession,
  OAuthTokenSet,
  ResolvedOAuthAppConfig,
} from "./oauth.js";

type JsonWebKey = Record<string, unknown>;
const execFileAsync = promisify(execFile);

interface BlueskyAuthorizationServerMetadata {
  authorization_endpoint?: string;
  issuer?: string;
  pushed_authorization_request_endpoint?: string;
  token_endpoint?: string;
}

interface BlueskyClientMetadataResponse {
  redirect_uris?: string[];
}

interface BlueskyParResponse {
  request_uri?: string;
}

interface BlueskyProfileResponse {
  avatar?: string;
  did?: string;
  displayName?: string;
  handle?: string;
}

interface BlueskyTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  sub?: string;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function createDpopProof(options: {
  clientId: string;
  method: string;
  nonce?: string;
  privateKey: crypto.KeyObject;
  publicJwk: JsonWebKey;
  url: string;
}): string {
  const header = {
    alg: "ES256",
    jwk: options.publicJwk,
    typ: "dpop+jwt",
  };

  const payload: Record<string, unknown> = {
    htm: options.method.toUpperCase(),
    htu: options.url,
    iat: Math.floor(Date.now() / 1000),
    iss: options.clientId,
    jti: crypto.randomUUID(),
  };

  if (options.nonce) {
    payload.nonce = options.nonce;
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const derSignature = crypto.sign("sha256", Buffer.from(signingInput), options.privateKey);
  const rawSignature = derToRaw(derSignature);

  return `${signingInput}.${base64UrlEncode(rawSignature)}`;
}

function generateDpopKeyPair(): {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateJwk: privateKey.export({ format: "jwk" }) as JsonWebKey,
    publicJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
  };
}

function createPrivateKey(privateJwk: JsonWebKey): crypto.KeyObject {
  return crypto.createPrivateKey({ format: "jwk", key: privateJwk });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface CurlJsonResponse<T> {
  data: T;
  nonce?: string;
  status: number;
  statusText: string;
}

function extractBlueskyError(data: unknown, fallback: string): string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return fallback;
  }

  const candidate = data as { error?: unknown; error_description?: unknown; message?: unknown };
  if (typeof candidate.error_description === "string" && candidate.error_description.trim()) {
    return candidate.error_description;
  }

  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message;
  }

  if (typeof candidate.error === "string" && candidate.error.trim()) {
    return candidate.error;
  }

  return fallback;
}

function parseCurlResponse<T>(stdout: string, label: string): CurlJsonResponse<T> {
  const normalized = stdout.replace(/\r\n/g, "\n");
  const separatorIndex = normalized.indexOf("\n\n");
  if (separatorIndex < 0) {
    throw new Error(`${label} returned an unreadable response from curl.`);
  }

  const rawHeaders = normalized.slice(0, separatorIndex);
  const body = normalized.slice(separatorIndex + 2);
  const headerLines = rawHeaders.split("\n");
  const statusLine = headerLines.shift();
  const statusMatch = statusLine?.match(/^HTTP\/\S+\s+(\d+)\s*(.*)$/);
  if (!statusMatch) {
    throw new Error(`${label} returned an unreadable HTTP status line from curl.`);
  }

  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  const status = Number.parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2] || "";

  let data: T;
  try {
    data = body ? (JSON.parse(body) as T) : ({} as T);
  } catch {
    const snippet = body.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`${label} returned a non-JSON response (${status}): ${snippet}`);
  }

  return {
    data,
    nonce: headers.get("dpop-nonce"),
    status,
    statusText,
  };
}

async function postCurlForm<T>(options: {
  body: URLSearchParams;
  dpopProof?: string;
  label: string;
  url: string;
}): Promise<CurlJsonResponse<T>> {
  try {
    const args = [
      "--silent",
      "--show-error",
      "--dump-header",
      "-",
      "--request",
      "POST",
      options.url,
      "--header",
      "Accept: application/json",
      "--header",
      "Content-Type: application/x-www-form-urlencoded",
      "--data",
      options.body.toString(),
    ];

    if (options.dpopProof) {
      args.push("--header", `DPoP: ${options.dpopProof}`);
    }

    const { stdout } = await execFileAsync("curl", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });

    return parseCurlResponse<T>(stdout, options.label);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.label} failed to execute curl: ${message}`);
  }
}

async function validateBlueskyClientMetadata(appConfig: ResolvedOAuthAppConfig): Promise<void> {
  const metadataUrl = appConfig.tokenMetadataUrl ?? appConfig.clientId;
  if (!/^https?:\/\//i.test(metadataUrl)) {
    return;
  }

  const metadata = await fetchJson<BlueskyClientMetadataResponse>(metadataUrl, { method: "GET" }, "Bluesky client metadata");
  const redirectUris = metadata.redirect_uris ?? [];
  if (!redirectUris.includes(appConfig.redirectUri)) {
    throw new Error(
      `The Bluesky client metadata at ${metadataUrl} does not include ${appConfig.redirectUri} in redirect_uris. Update the hosted metadata or override the client ID with SIMPLE_POST_BLUESKY_CLIENT_ID.`,
    );
  }
}

async function discoverBlueskyAuthorizationServer(appConfig: ResolvedOAuthAppConfig): Promise<BlueskyAuthorizationServerMetadata> {
  const issuerUrl = new URL(appConfig.authorizationUrl);
  const metadataUrl = new URL("/.well-known/oauth-authorization-server", issuerUrl.origin);
  const metadata = await fetchJson<BlueskyAuthorizationServerMetadata>(
    metadataUrl.toString(),
    { method: "GET" },
    "Bluesky authorization server metadata",
  );

  if (!metadata.authorization_endpoint || !metadata.pushed_authorization_request_endpoint || !metadata.token_endpoint) {
    throw new Error("Bluesky authorization server metadata is missing required OAuth endpoints.");
  }

  return metadata;
}

async function postDpopForm<T>(options: {
  body: URLSearchParams;
  label: string;
  nonce?: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  url: string;
}): Promise<CurlJsonResponse<T>> {
  return postCurlForm<T>({
    body: options.body,
    dpopProof: createDpopProof({
      clientId: options.body.get("client_id") ?? "",
      method: "POST",
      ...(options.nonce ? { nonce: options.nonce } : {}),
      privateKey: createPrivateKey(options.privateJwk),
      publicJwk: options.publicJwk,
      url: options.url,
    }),
    label: options.label,
    url: options.url,
  });
}

async function postForm<T>(options: {
  body: URLSearchParams;
  label: string;
  url: string;
}): Promise<CurlJsonResponse<T>> {
  return postCurlForm<T>(options);
}

async function pushAuthorizationRequest(appConfig: ResolvedOAuthAppConfig): Promise<OAuthAuthorizationSession> {
  await validateBlueskyClientMetadata(appConfig);
  const metadata = await discoverBlueskyAuthorizationServer(appConfig);
  const authorizationEndpoint = metadata.authorization_endpoint!;
  const pushedAuthorizationRequestEndpoint = metadata.pushed_authorization_request_endpoint!;
  const tokenEndpoint = metadata.token_endpoint!;
  const { codeChallenge, codeVerifier } = await generatePkcePair();
  const { privateJwk, publicJwk } = generateDpopKeyPair();
  const state = crypto.randomUUID();
  const resolvedAppConfig: ResolvedOAuthAppConfig = {
    ...appConfig,
    authorizationUrl: authorizationEndpoint,
    tokenUrl: tokenEndpoint,
  };

  const body = new URLSearchParams({
    client_id: resolvedAppConfig.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: resolvedAppConfig.redirectUri,
    response_type: "code",
    scope: resolvedAppConfig.scopes.join(" "),
    state,
  });

  const pushed = await postForm<BlueskyParResponse>({
    body,
    label: "Bluesky pushed authorization request",
    url: pushedAuthorizationRequestEndpoint,
  });

  if (pushed.status < 200 || pushed.status >= 300 || !pushed.data.request_uri) {
    throw new Error(
      `Bluesky pushed authorization request failed (${pushed.status}): ${extractBlueskyError(pushed.data, pushed.statusText)}`,
    );
  }

  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set("client_id", resolvedAppConfig.clientId);
  authUrl.searchParams.set("request_uri", pushed.data.request_uri);

  return {
    appConfig: resolvedAppConfig,
    authUrl: authUrl.toString(),
    codeVerifier,
    sessionData: {
      dpopPrivateJwk: privateJwk,
      dpopPublicJwk: publicJwk,
      tokenDpopNonce: pushed.nonce,
    },
    state,
  };
}

async function exchangeBlueskyCode(input: {
  appConfig: ResolvedOAuthAppConfig;
  code: string;
  codeVerifier?: string;
  sessionData?: Record<string, unknown>;
}): Promise<OAuthTokenSet> {
  const privateJwk = input.sessionData?.dpopPrivateJwk;
  const publicJwk = input.sessionData?.dpopPublicJwk;
  if (typeof privateJwk !== "object" || privateJwk === null || Array.isArray(privateJwk)) {
    throw new Error("Bluesky OAuth session is missing its DPoP private key.");
  }
  if (typeof publicJwk !== "object" || publicJwk === null || Array.isArray(publicJwk)) {
    throw new Error("Bluesky OAuth session is missing its DPoP public key.");
  }
  const privateDpopJwk = privateJwk as JsonWebKey;
  const publicDpopJwk = publicJwk as JsonWebKey;

  const body = new URLSearchParams({
    client_id: input.appConfig.clientId,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.appConfig.redirectUri,
  });

  if (input.codeVerifier) {
    body.set("code_verifier", input.codeVerifier);
  }

  let tokenResponse = await postDpopForm<BlueskyTokenResponse>({
    body,
    label: "Bluesky token exchange",
    ...(typeof input.sessionData?.tokenDpopNonce === "string" ? { nonce: input.sessionData.tokenDpopNonce } : {}),
    privateJwk: privateDpopJwk,
    publicJwk: publicDpopJwk,
    url: input.appConfig.tokenUrl,
  });

  if ((tokenResponse.status < 200 || tokenResponse.status >= 300) && tokenResponse.nonce) {
    tokenResponse = await postDpopForm<BlueskyTokenResponse>({
      body,
      label: "Bluesky token exchange",
      nonce: tokenResponse.nonce,
      privateJwk: privateDpopJwk,
      publicJwk: publicDpopJwk,
      url: input.appConfig.tokenUrl,
    });
  }

  if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
    throw new Error(
      `Bluesky token exchange failed (${tokenResponse.status}): ${extractBlueskyError(tokenResponse.data, tokenResponse.statusText)}`,
    );
  }

  if (!tokenResponse.data.access_token) {
    throw new Error("Bluesky token exchange returned no access token.");
  }

  return {
    accessToken: tokenResponse.data.access_token,
    expiresAt:
      typeof tokenResponse.data.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokenResponse.data.expires_in
        : undefined,
    raw: tokenResponse.data,
    refreshToken: tokenResponse.data.refresh_token,
    tokenMetadata: {
      clientId: input.appConfig.clientId,
      dpopPrivateJwk: privateDpopJwk,
      dpopPublicJwk: publicDpopJwk,
      tokenUrl: input.appConfig.tokenUrl,
    },
  };
}

async function fetchBlueskyProfile(did: string): Promise<BlueskyProfileResponse> {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile");
  url.searchParams.set("actor", did);
  return fetchJson<BlueskyProfileResponse>(url.toString(), { method: "GET" }, "Bluesky profile lookup");
}

async function fetchBlueskyPdsUrl(did: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://plc.directory/${did}`);
    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { service?: Array<{ id?: string; serviceEndpoint?: string; type?: string }> };
    const services = Array.isArray(data.service) ? data.service : [];
    const pdsService = services.find(
      (service) => service.id === "#atproto_pds" || service.type === "AtprotoPersonalDataServer",
    );
    return pdsService?.serviceEndpoint;
  } catch {
    return undefined;
  }
}

export class BlueskyAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("bluesky", {
      async completeLogin({ tokenSet }) {
        const payload = decodeJwtPayload(tokenSet.accessToken);
        const raw = typeof tokenSet.raw === "object" && tokenSet.raw !== null ? (tokenSet.raw as { sub?: string }) : {};
        const did = raw.sub ?? (typeof payload?.sub === "string" ? payload.sub : undefined);
        if (!did) {
          throw new Error("Bluesky did not return a DID for the connected account.");
        }

        const profile = await fetchBlueskyProfile(did);
        const pdsUrl = (await fetchBlueskyPdsUrl(did)) ?? "https://bsky.social";

        return {
          displayName: profile.displayName ?? profile.handle,
          secretPayload: {
            tokenMetadata: {
              ...(tokenSet.tokenMetadata ?? {}),
              pdsUrl,
            },
          },
          userId: did,
          username: profile.handle,
        };
      },
      exchangeCode({ appConfig, code, codeVerifier, sessionData }) {
        return exchangeBlueskyCode({ appConfig, code, codeVerifier, sessionData });
      },
      startAuthorization({ appConfig }) {
        return pushAuthorizationRequest(appConfig);
      },
    });
  }
}
