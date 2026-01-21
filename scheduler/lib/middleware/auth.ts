import { type NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { UnauthorizedError } from "@/lib/utils/errors";

/**
 * Requires authentication and returns the session
 * Throws UnauthorizedError if not authenticated
 */
export async function requireAuth(req: NextRequest) {
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
  return await auth.api.getSession({ headers: req.headers });
}
