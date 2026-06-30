import { NextResponse } from "next/server";

import { getAppBaseUrl, getMcpDocumentationUrl, getMcpResourceUrl, MCP_SCOPES } from "@/lib/mcp/config";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 * Tells MCP clients where the authorization server is.
 */
export function GET() {
  const baseUrl = getAppBaseUrl();

  return NextResponse.json(
    {
      resource: getMcpResourceUrl(),
      authorization_servers: [baseUrl],
      scopes_supported: MCP_SCOPES,
      resource_documentation: getMcpDocumentationUrl(),
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
