import type { NextRequest } from "next/server";

/**
 * Accept requests without an Origin header (CLI/API clients) and same-origin
 * browser requests. Browser requests from any other origin fail closed.
 */
export function hasAllowedOrigin(req: Pick<NextRequest, "headers">): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
