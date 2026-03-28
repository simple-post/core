import crypto from "node:crypto";

import { type NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
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
  prisma.cliToken.update({
    where: { id: cliToken.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

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
 * Requires authentication and returns the session
 * Throws UnauthorizedError if not authenticated
 */
export async function requireAuth(req: NextRequest) {
  // Try CLI bearer token first
  const cliSession = await authenticateCliToken(req);
  if (cliSession) {
    return cliSession;
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

  return await auth.api.getSession({ headers: req.headers });
}
