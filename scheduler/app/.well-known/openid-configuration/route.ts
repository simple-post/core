import { NextResponse } from "next/server";

import { getAppBaseUrl, getOidcJwksUrl, getOidcUserInfoUrl, MCP_AUTHORIZATION_SCOPES } from "@/lib/mcp/config";

/** OpenID Connect Discovery 1.0 provider metadata. */
export function GET() {
  const baseUrl = getAppBaseUrl();

  return NextResponse.json(
    {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/api/oauth/token`,
      userinfo_endpoint: getOidcUserInfoUrl(),
      jwks_uri: getOidcJwksUrl(),
      registration_endpoint: `${baseUrl}/api/oauth/register`,
      revocation_endpoint: `${baseUrl}/api/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: MCP_AUTHORIZATION_SCOPES,
      claims_supported: ["sub", "email", "email_verified", "name"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
