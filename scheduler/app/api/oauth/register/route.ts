import { NextResponse, type NextRequest } from "next/server";

import { isAllowedMcpRedirectUri, validateMcpScope } from "@/lib/mcp/config";
import { registerClient } from "@/lib/mcp/oauth";

/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591).
 * MCP clients call this to register themselves before starting the OAuth flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const clientName =
      typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim()
        : typeof body.software_id === "string" && body.software_id.trim()
          ? body.software_id.trim()
          : "MCP Client";

    const tokenEndpointAuthMethod =
      body.token_endpoint_auth_method === "none" ? "none" : body.token_endpoint_auth_method || "client_secret_post";
    if (tokenEndpointAuthMethod !== "client_secret_post" && tokenEndpointAuthMethod !== "none") {
      return NextResponse.json(
        {
          error: "invalid_client_metadata",
          error_description: "token_endpoint_auth_method must be client_secret_post or none",
        },
        { status: 400 },
      );
    }

    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return NextResponse.json(
        { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
        { status: 400 },
      );
    }

    for (const uri of redirectUris) {
      if (typeof uri !== "string") {
        return NextResponse.json(
          { error: "invalid_client_metadata", error_description: "redirect_uris must be strings" },
          { status: 400 },
        );
      }
      try {
        new URL(uri);
      } catch {
        return NextResponse.json(
          { error: "invalid_client_metadata", error_description: `Invalid redirect URI: ${uri}` },
          { status: 400 },
        );
      }
      if (!isAllowedMcpRedirectUri(uri)) {
        return NextResponse.json(
          {
            error: "invalid_client_metadata",
            error_description: `Redirect URI must use HTTPS or HTTP loopback: ${uri}`,
          },
          { status: 400 },
        );
      }
    }

    const scopeResult = validateMcpScope(typeof body.scope === "string" ? body.scope : undefined);
    if (!scopeResult.ok) {
      return NextResponse.json(
        {
          error: "invalid_client_metadata",
          error_description: `Unsupported scope(s): ${scopeResult.unsupported.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const { clientId, clientSecret } = await registerClient({
      name: clientName,
      redirectUris,
      scope: scopeResult.scope,
      tokenEndpointAuthMethod,
    });

    return NextResponse.json(
      {
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        scope: scopeResult.scope,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Client registration error:", message, error);
    return NextResponse.json(
      { error: "server_error", error_description: `Registration failed: ${message}` },
      { status: 500 },
    );
  }
}
