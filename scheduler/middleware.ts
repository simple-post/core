import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/v1/", "/api/connect/"];

const MCP_CORS_PREFIXES = ["/mcp", "/.well-known/oauth-", "/api/oauth/"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function isMcpCorsRoute(pathname: string): boolean {
  return MCP_CORS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Next.js middleware for:
 * 1. CSRF/origin validation on state-changing API requests
 * 2. CORS headers for MCP/OAuth endpoints
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Handle CORS for MCP-related routes
  if (isMcpCorsRoute(pathname)) {
    // Preflight
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    // Actual request — add CORS headers to the response
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // CSRF checks for protected API routes
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
  matcher: ["/api/v1/:path*", "/api/connect/:path*", "/mcp", "/.well-known/:path*", "/api/oauth/:path*"],
};
