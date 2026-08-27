import { type NextRequest, NextResponse } from "next/server";

import { hasMcpAuthorizationScope } from "@/lib/mcp/config";
import { authenticateMcpToken } from "@/lib/mcp/oauth";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function unauthorized(error: "invalid_token" | "insufficient_scope", description: string, status = 401) {
  const challenge = `Bearer realm="SimplePost", error="${error}", error_description="${description}"`;
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        ...NO_STORE_HEADERS,
        "WWW-Authenticate": challenge,
      },
    },
  );
}

async function userInfo(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return unauthorized("invalid_token", "A bearer access token is required");
  }

  const auth = await authenticateMcpToken(authorization.slice("Bearer ".length).trim());
  if (!auth) {
    return unauthorized("invalid_token", "The access token is invalid or expired");
  }

  if (
    !hasMcpAuthorizationScope(auth.session.scope, "openid") ||
    !hasMcpAuthorizationScope(auth.session.scope, "email")
  ) {
    return unauthorized("insufficient_scope", "The openid and email scopes are required", 403);
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
