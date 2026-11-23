import { type NextRequest, NextResponse } from "next/server";

import { oauthError } from "@/lib/i18n/oauth-display";
import { serverMessage } from "@/lib/i18n/server";

import {
  cleanupExpiredCliCredentials,
  exchangeCliAuthorizationCode,
  isCliToken,
  revokeCliToken,
} from "@/lib/cli/tokens";
import { createLogger, serializeError } from "@/lib/logger";

const log = createLogger("api:cli:token");
const CLI_ERROR_DESCRIPTIONS = {
  code_not_found: serverMessage("code not found"),
  code_expired: serverMessage("code expired"),
  redirect_uri_mismatch: serverMessage("redirect uri mismatch"),
};

async function requestParameters(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await req.text()));
  }
  return (await req.json()) as Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    const params = await requestParameters(req);
    const code = params.code;
    const redirectUri = params.redirect_uri;

    if (!code || !redirectUri) {
      return oauthError(req, "invalid_request", serverMessage("code and redirect_uri are required"), { status: 400 });
    }

    const result = await exchangeCliAuthorizationCode(code, redirectUri);
    if (!result.ok) {
      return oauthError(req, "invalid_grant", CLI_ERROR_DESCRIPTIONS[result.error], { status: 400 });
    }

    void cleanupExpiredCliCredentials().catch((error) => {
      log.warn({ err: serializeError(error) }, "Failed to clean up expired CLI credentials");
    });

    return NextResponse.json({
      access_token: result.token,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      user: result.user,
    });
  } catch (error) {
    log.error({ err: serializeError(error) }, "CLI token exchange failed");
    return oauthError(req, "server_error", serverMessage("CLI token exchange failed"), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!isCliToken(token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  await revokeCliToken(token);
  return new NextResponse(null, { status: 204 });
}
