import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 * Tells MCP clients where the authorization server is.
 */
export function GET() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return NextResponse.json(
    {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
