import type { NextRequest } from "next/server";

interface LogUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

// Keep identity attached to the exact authenticated request, never global async state.
const requestUsers = new WeakMap<NextRequest, LogUser>();

export function rememberRequestUser(req: NextRequest, user: LogUser): void {
  requestUsers.set(req, { id: user.id, email: user.email, name: user.name });
}

export async function requestErrorContext(req: NextRequest): Promise<Record<string, unknown>> {
  const user = requestUsers.get(req);
  const context: Record<string, unknown> = {
    requestMethod: req.method,
    requestPath: new URL(req.url).pathname,
    userIdentityStatus: user ? "authenticated" : "unavailable (authentication not completed)",
    ...(user && { userId: user.id, userEmail: user.email, userName: user.name }),
  };
  if (!user) return context;

  try {
    const { prisma } = await import("@/lib/prisma");
    context.connectedAccounts = await prisma.connectedAccount.findMany({
      where: { userId: user.id },
      select: { id: true, platform: true, username: true, displayName: true, platformAccountId: true },
      orderBy: { id: "asc" },
    });
  } catch {
    // A database outage must not hide the original error or the known user.
    context.connectedAccountsStatus = "unavailable (account lookup failed)";
  }
  return context;
}
