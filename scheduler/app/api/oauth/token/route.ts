import { type NextRequest, NextResponse } from "next/server";

import { exchangeCodeForToken, hashValue } from "@/lib/mcp/oauth";
import { prisma } from "@/lib/prisma";

const ERROR_DESCRIPTIONS: Record<string, string> = {
  code_not_found: "Authorization code not found or already used",
  client_mismatch: "Client ID does not match the authorization code",
  redirect_uri_mismatch: "Redirect URI does not match the authorization code",
  code_expired: "Authorization code has expired",
  pkce_failed: "PKCE code_verifier validation failed",
};

/**
 * POST /oauth/token — Token endpoint.
 * Exchanges an authorization code + PKCE verifier for an access token.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let params: Record<string, string>;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else {
      params = await req.json();
    }

    const { grant_type, code, client_id, client_secret, redirect_uri, code_verifier } = params;

    if (grant_type !== "authorization_code") {
      return NextResponse.json(
        { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
        { status: 400 },
      );
    }

    if (!code || !client_id || !redirect_uri || !code_verifier) {
      const missing = [
        !code && "code",
        !client_id && "client_id",
        !redirect_uri && "redirect_uri",
        !code_verifier && "code_verifier",
      ].filter(Boolean);
      return NextResponse.json(
        { error: "invalid_request", error_description: `Missing required parameters: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    // Validate client exists
    const client = await prisma.mcpOAuthClient.findUnique({
      where: { clientId: client_id },
    });

    if (!client) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "Unknown client" },
        { status: 401 },
      );
    }

    // If client has a secret, verify it
    if (client.clientSecret) {
      if (!client_secret) {
        return NextResponse.json(
          { error: "invalid_client", error_description: "Client secret required" },
          { status: 401 },
        );
      }
      if (hashValue(client_secret) !== client.clientSecret) {
        return NextResponse.json(
          { error: "invalid_client", error_description: "Invalid client secret" },
          { status: 401 },
        );
      }
    }

    // Exchange code for token
    const result = await exchangeCodeForToken({
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeVerifier: code_verifier,
    });

    if (!result.ok) {
      console.error("Token exchange failed:", result.error, { client_id, redirect_uri });
      return NextResponse.json(
        { error: "invalid_grant", error_description: ERROR_DESCRIPTIONS[result.error] || result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Token endpoint error:", message, error);
    return NextResponse.json(
      { error: "server_error", error_description: `Token exchange failed: ${message}` },
      { status: 500 },
    );
  }
}
