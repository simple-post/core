import { NextResponse, type NextRequest } from "next/server";

import { registerClient } from "@/lib/mcp/oauth";

/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591).
 * MCP clients call this to register themselves before starting the OAuth flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const clientName = body.client_name;
    if (!clientName || typeof clientName !== "string") {
      return NextResponse.json(
        { error: "invalid_client_metadata", error_description: "client_name is required" },
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
    }

    const scope = typeof body.scope === "string" ? body.scope : undefined;

    const { clientId, clientSecret } = await registerClient({
      name: clientName,
      redirectUris,
      scope,
    });

    return NextResponse.json(
      {
        client_id: clientId,
        client_secret: clientSecret,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        scope,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Client registration error:", error);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to register client" },
      { status: 500 },
    );
  }
}
