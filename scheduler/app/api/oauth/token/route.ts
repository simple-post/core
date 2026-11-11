import { type NextRequest, NextResponse } from "next/server";

import { oauthError } from "@/lib/i18n/oauth-display";
import { serverMessage } from "@/lib/i18n/server";

import { createLogger, serializeError } from "@/lib/logger";
import { resolveMcpResource } from "@/lib/mcp/config";
import { cleanupExpired, exchangeCodeForToken, hashValue } from "@/lib/mcp/oauth";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:oauth:token");

const ERROR_DESCRIPTIONS: Record<string, ReturnType<typeof serverMessage>> = {
  code_not_found: serverMessage("Authorization code not found or already used"),
  user_not_found: serverMessage("The authorizing user no longer exists"),
  client_mismatch: serverMessage("Client ID does not match the authorization code"),
  redirect_uri_mismatch: serverMessage("Redirect URI does not match the authorization code"),
  resource_mismatch: serverMessage("Resource does not match the authorization code"),
  code_expired: serverMessage("Authorization code has expired"),
  pkce_failed: serverMessage("PKCE code_verifier validation failed"),
};

function parseBasicAuth(authHeader: string | null): { clientId: string; clientSecret: string } | null {
  if (!authHeader?.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;

    return {
      clientId: decoded.slice(0, separatorIndex),
      clientSecret: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

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

    const basicAuth = parseBasicAuth(req.headers.get("authorization"));
    const grant_type = params.grant_type;
    const code = params.code;
    const client_id = params.client_id || basicAuth?.clientId;
    const client_secret = params.client_secret || basicAuth?.clientSecret;
    const redirect_uri = params.redirect_uri;
    const code_verifier = params.code_verifier;
    const resource = params.resource;

    if (grant_type !== "authorization_code") {
      return oauthError(req, "unsupported_grant_type", serverMessage("Only authorization_code is supported"), {
        status: 400,
      });
    }

    if (!code || !client_id || !redirect_uri || !code_verifier) {
      const missing = [
        !code && "code",
        !client_id && "client_id",
        !redirect_uri && "redirect_uri",
        !code_verifier && "code_verifier",
      ].filter(Boolean);
      return oauthError(
        req,
        "invalid_request",
        serverMessage("Missing required parameters: {{parameters}}", { parameters: missing.join(", ") }),
        { status: 400 },
      );
    }

    let resolvedResource: string;
    try {
      resolvedResource = resolveMcpResource(resource);
    } catch (error) {
      return oauthError(
        req,
        "invalid_target",
        typeof resource === "string"
          ? serverMessage("Unsupported MCP resource: {{resource}}", { resource })
          : error instanceof Error
            ? error.message
            : serverMessage("Unsupported MCP resource"),
        { status: 400 },
      );
    }

    // Validate client exists
    const client = await prisma.mcpOAuthClient.findUnique({
      where: { clientId: client_id },
    });

    if (!client) {
      return oauthError(req, "invalid_client", serverMessage("Unknown client"), { status: 401 });
    }

    // If client has a secret, verify it
    if (client.clientSecret) {
      if (!client_secret) {
        return oauthError(req, "invalid_client", serverMessage("Client secret required"), { status: 401 });
      }
      if (hashValue(client_secret) !== client.clientSecret) {
        return oauthError(req, "invalid_client", serverMessage("Invalid client secret"), { status: 401 });
      }
    }

    // Exchange code for token
    const result = await exchangeCodeForToken({
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      resource: resolvedResource,
      codeVerifier: code_verifier,
    });

    if (!result.ok) {
      log.warn({ error: result.error, clientId: client_id, redirectUri: redirect_uri }, "Token exchange failed");
      return oauthError(req, "invalid_grant", ERROR_DESCRIPTIONS[result.error] || result.error, { status: 400 });
    }

    void cleanupExpired().catch((error) => {
      log.warn({ err: serializeError(error) }, "Failed to clean up expired MCP credentials");
    });

    return NextResponse.json({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      scope: result.scope,
      ...(result.idToken ? { id_token: result.idToken } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: serializeError(error) }, "Token endpoint error");
    return oauthError(req, "server_error", serverMessage("Token exchange failed: {{detail}}", { detail: message }), {
      status: 500,
    });
  }
}
