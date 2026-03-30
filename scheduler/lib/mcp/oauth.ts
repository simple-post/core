import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "sp_mcp_";
const CODE_BYTES = 32;
const TOKEN_BYTES = 32;

/** SHA-256 hash a string and return hex. */
export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Generate a random authorization code. */
export function generateAuthorizationCode(): string {
  return crypto.randomBytes(CODE_BYTES).toString("base64url");
}

/** Generate a random access token with prefix. */
export function generateAccessToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Generate a random client ID. */
export function generateClientId(): string {
  return "mcp_" + crypto.randomBytes(16).toString("base64url");
}

/** Generate a random client secret. */
export function generateClientSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Verify PKCE S256 challenge: base64url(sha256(verifier)) === challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return computed === codeChallenge;
}

/** Check if a bearer token is an MCP access token. */
export function isMcpToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

/** Store an authorization code in the database. Returns the raw code. */
export async function createAuthorizationCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
}): Promise<string> {
  const code = generateAuthorizationCode();
  const codeHash = hashValue(code);

  await prisma.mcpAuthorizationCode.create({
    data: {
      codeHash,
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      scope: params.scope,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  return code;
}

/** Exchange an authorization code for an access token. Returns the raw token or null. */
export async function exchangeCodeForToken(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; expiresIn: number } | null> {
  const codeHash = hashValue(params.code);

  const authCode = await prisma.mcpAuthorizationCode.findUnique({
    where: { codeHash },
  });

  if (!authCode) return null;

  // Delete the code immediately (single-use)
  await prisma.mcpAuthorizationCode.delete({ where: { id: authCode.id } });

  // Validate
  if (authCode.clientId !== params.clientId) return null;
  if (authCode.redirectUri !== params.redirectUri) return null;
  if (authCode.expiresAt < new Date()) return null;

  // Verify PKCE
  if (!verifyPkceS256(params.codeVerifier, authCode.codeChallenge)) return null;

  // Issue access token
  const accessToken = generateAccessToken();
  const tokenHash = hashValue(accessToken);
  const expiresIn = 90 * 24 * 60 * 60; // 90 days in seconds

  await prisma.mcpAccessToken.create({
    data: {
      tokenHash,
      clientId: authCode.clientId,
      userId: authCode.userId,
      scope: authCode.scope,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return { accessToken, expiresIn };
}

/** Authenticate an MCP access token. Returns user info or null. */
export async function authenticateMcpToken(token: string) {
  if (!isMcpToken(token)) return null;

  const tokenHash = hashValue(token);

  const mcpToken = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!mcpToken) return null;
  if (mcpToken.expiresAt < new Date()) return null;

  // Update lastUsedAt (fire-and-forget)
  prisma.mcpAccessToken
    .update({
      where: { id: mcpToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    user: {
      id: mcpToken.user.id,
      name: mcpToken.user.name,
      email: mcpToken.user.email,
      image: mcpToken.user.image,
    },
    session: {
      id: mcpToken.id,
      token: "mcp",
      expiresAt: mcpToken.expiresAt,
    },
  };
}

/** Register a new OAuth client (Dynamic Client Registration). */
export async function registerClient(params: {
  name: string;
  redirectUris: string[];
  scope?: string;
}): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const clientSecretHash = hashValue(clientSecret);

  await prisma.mcpOAuthClient.create({
    data: {
      clientId,
      clientSecret: clientSecretHash,
      name: params.name,
      redirectUris: params.redirectUris,
      scope: params.scope,
    },
  });

  return { clientId, clientSecret };
}

/** Validate a client exists and the redirect URI is allowed. */
export async function validateClient(clientId: string, redirectUri?: string) {
  const client = await prisma.mcpOAuthClient.findUnique({
    where: { clientId },
  });

  if (!client) return null;

  if (redirectUri && !client.redirectUris.includes(redirectUri)) {
    return null;
  }

  return client;
}

/** Clean up expired authorization codes and tokens. */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.mcpAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.mcpAccessToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
