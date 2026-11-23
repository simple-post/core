import { type NextRequest, NextResponse } from "next/server";

import { oauthError } from "@/lib/i18n/oauth-display";
import { canonicalMessage, serverMessage, type AuthoredMessage } from "@/lib/i18n/server";
import { hasMcpAuthorizationScope } from "@/lib/mcp/config";
import { authenticateMcpToken } from "@/lib/mcp/oauth";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function unauthorized(
  req: NextRequest,
  error: "invalid_token" | "insufficient_scope",
  description: AuthoredMessage,
  status = 401,
) {
  const challenge = `Bearer realm="SimplePost", error="${error}", error_description="${canonicalMessage(description)}"`;
  return oauthError(req, error, description, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      "WWW-Authenticate": challenge,
    },
  });
}

async function userInfo(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return unauthorized(req, "invalid_token", serverMessage("A bearer access token is required"));
  }

  const auth = await authenticateMcpToken(authorization.slice("Bearer ".length).trim());
  if (!auth) {
    return unauthorized(req, "invalid_token", serverMessage("The access token is invalid or expired"));
  }

  if (
    !hasMcpAuthorizationScope(auth.session.scope, "openid") ||
    !hasMcpAuthorizationScope(auth.session.scope, "email")
  ) {
    return unauthorized(req, "insufficient_scope", serverMessage("The openid and email scopes are required"), 403);
  }

  return NextResponse.json(
    {
      sub: auth.user.id,
      email: auth.user.email,
      email_verified: auth.user.emailVerified,
      ...(auth.user.name ? { name: auth.user.name } : {}),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export const GET = userInfo;
export const POST = userInfo;
