import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/v1/", "/api/connect/"];

/**
 * Next.js middleware for CSRF/origin validation on state-changing API requests.
 * Verifies that the Origin header matches the app URL for POST/PATCH/PUT/DELETE requests.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply CSRF checks to protected API routes
  const isProtectedApi = PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtectedApi) {
    return NextResponse.next();
  }

  // Only check state-changing methods
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }

  // Verify Origin header
  const origin = req.headers.get("origin");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const allowedOrigin = new URL(appUrl).origin;

  if (origin && origin !== allowedOrigin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/v1/:path*", "/api/connect/:path*"],
};
