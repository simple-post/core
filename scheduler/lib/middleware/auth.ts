import crypto from "node:crypto";

import { type NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { authenticateMcpToken, isMcpToken } from "@/lib/mcp/oauth";
import { prisma } from "@/lib/prisma";
import { hashApiKey, isApiKey } from "@/lib/security/api-keys";
import { UnauthorizedError } from "@/lib/utils/errors";

const CLI_TOKEN_PREFIX = "sp_cli_";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Authenticate via CLI bearer token (Authorization: Bearer sp_cli_...).
 * Returns a session-like object if valid, or null.
 */
async function authenticateCliToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith(`Bearer ${CLI_TOKEN_PREFIX}`)) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  const tokenHash = hashToken(token);

  const cliToken = await prisma.cliToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!cliToken) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.cliToken
    .update({
      where: { id: cliToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    user: {
      id: cliToken.user.id,
      name: cliToken.user.name,
      email: cliToken.user.email,
      image: cliToken.user.image,
    },
    session: {
      id: cliToken.id,
      token: "cli",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  };
}

/**
 * Authenticate via MCP bearer token (Authorization: Bearer sp_mcp_...).
 * Returns a session-like object if valid, or null.
 */
async function authenticateMcpBearerToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  if (!isMcpToken(token)) return null;

  return authenticateMcpToken(token);
}

/**
 * Authenticate via API key bearer token (Authorization: Bearer sp_api_...).
 * Returns a session-like object if valid, or null.
 */
async function authenticateApiKey(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  if (!isApiKey(token)) return null;

  const tokenHash = hashApiKey(token);
  const apiKey = await prisma.apiKey.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!apiKey || apiKey.revokedAt) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    user: {
      id: apiKey.user.id,
      name: apiKey.user.name,
      email: apiKey.user.email,
      image: apiKey.user.image,
    },
    session: {
      id: apiKey.id,
      token: "api_key",
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    },
  };
}

/**
 * Requires authentication and returns the session
 * Throws UnauthorizedError if not authenticated
 */
export async function requireAuth(req: NextRequest) {
  // Try CLI bearer token first
  const cliSession = await authenticateCliToken(req);
  if (cliSession) {
    return cliSession;
  }

  // Try MCP bearer token
  const mcpSession = await authenticateMcpBearerToken(req);
  if (mcpSession) {
    return mcpSession;
  }

  // Try API key bearer token
  const apiKeySession = await authenticateApiKey(req);
  if (apiKeySession) {
    return apiKeySession;
  }

  // Fall back to session-based auth
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required");
  }

  return session;
}

/**
 * Gets the session without throwing if not authenticated
 * Useful for optional authentication checks
 */
export async function getSession(req: NextRequest) {
  const cliSession = await authenticateCliToken(req);
  if (cliSession) {
    return cliSession;
  }

  const mcpSession = await authenticateMcpBearerToken(req);
  if (mcpSession) {
    return mcpSession;
  }

  const apiKeySession = await authenticateApiKey(req);
  if (apiKeySession) {
    return apiKeySession;
  }

  return await auth.api.getSession({ headers: req.headers });
}

/**
 * Requires a browser session managed by Better Auth.
 * API keys, CLI tokens, and MCP tokens are intentionally not accepted here.
 */
export async function requireBrowserSession(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required");
  }

  return session;
}
