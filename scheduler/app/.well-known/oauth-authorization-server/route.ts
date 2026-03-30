import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * MCP clients discover OAuth endpoints from this document.
 */
export function GET() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return NextResponse.json(
    {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/api/oauth/token`,
      registration_endpoint: `${baseUrl}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["post", "read"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
