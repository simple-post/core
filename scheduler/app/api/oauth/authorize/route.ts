import { type NextRequest, NextResponse } from "next/server";

import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import {
  canUpgradeLegacyMcpClientScope,
  isMcpScopeSubset,
  resolveMcpResource,
  validateMcpScope,
} from "@/lib/mcp/config";
import { createAuthorizationCode, updateClientScope, validateClient } from "@/lib/mcp/oauth";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

/**
 * POST /oauth/authorize — Process the consent form submission.
 * Called by the authorize page when the user approves access.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    await assertActiveSubscription(session.user.id);
    const body = await req.json();

    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, resource } = body;

    if (!client_id || !redirect_uri || !state || !code_challenge) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing required parameters" },
        { status: 400 },
      );
    }

    if (code_challenge_method && code_challenge_method !== "S256") {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" },
        { status: 400 },
      );
    }

    // Validate client and redirect URI
    const client = await validateClient(client_id, redirect_uri);
    if (!client) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "Unknown client or invalid redirect URI" },
        { status: 400 },
      );
    }

    let resolvedResource: string;
    try {
      resolvedResource = resolveMcpResource(resource);
    } catch (error) {
      return NextResponse.json(
        {
          error: "invalid_target",
          error_description: error instanceof Error ? error.message : "Unsupported MCP resource",
        },
        { status: 400 },
      );
    }

    const scopeResult = validateMcpScope(typeof scope === "string" ? scope : client.scope);
    if (!scopeResult.ok) {
      return NextResponse.json(
        { error: "invalid_scope", error_description: `Unsupported scope(s): ${scopeResult.unsupported.join(", ")}` },
        { status: 400 },
      );
    }
    if (!isMcpScopeSubset(scopeResult.scope, client.scope)) {
      // Existing ChatGPT dynamic clients registered before posts:read need a
      // one-time compatibility upgrade when the user approves the new scope.
      if (canUpgradeLegacyMcpClientScope(scopeResult.scope, client.scope)) {
        await updateClientScope(client_id, scopeResult.scope);
      } else {
        return NextResponse.json(
          { error: "invalid_scope", error_description: "Requested scopes exceed registered client scopes" },
          { status: 400 },
        );
      }
    }

    // Generate authorization code
    const code = await createAuthorizationCode({
      clientId: client_id,
      userId: session.user.id,
      redirectUri: redirect_uri,
      resource: resolvedResource,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || "S256",
      scope: scopeResult.scope,
    });

    // Build redirect URL with code and state
    const redirect = new URL(redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", state);

    return NextResponse.json({ redirectUrl: redirect.toString() });
  } catch (error) {
    return handleApiError(error);
  }
}
