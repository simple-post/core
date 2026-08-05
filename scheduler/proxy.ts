import { type NextRequest, NextResponse } from "next/server";

import { hasAllowedOrigin } from "@/lib/middleware/origin";

const PROTECTED_API_PREFIXES = ["/api/v1/", "/api/connect/", "/api/billing/"];

const MCP_CORS_PREFIXES = ["/mcp", "/.well-known/oauth-", "/api/oauth/"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

function isMcpCorsRoute(pathname: string): boolean {
  return MCP_CORS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Next.js proxy for:
 * 1. CSRF/origin validation on state-changing API requests
 * 2. CORS headers for MCP/OAuth endpoints
 */
export function proxy(req: NextRequest) {
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
  if (!hasAllowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Keep the streaming multipart endpoint out of Proxy. Next.js buffers
    // Proxy request bodies and truncates them at 10 MB by default. The upload
    // route performs the same origin check itself without buffering the body.
    "/api/v1",
    "/api/v1/((?!upload/?$).*)",
    "/api/connect/:path*",
    "/api/billing/:path*",
    "/mcp",
    "/.well-known/:path*",
    "/api/oauth/:path*",
  ],
};
