import { NextResponse, type NextRequest } from "next/server";

import { assertPlanFeature } from "@/lib/billing/subscriptions";
import { createCliAuthorizationCode } from "@/lib/cli/tokens";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    await assertPlanFeature(session.user.id, "cliAccess", { action: "cli_authorize" });
    const body = await req.json();
    const { state, redirectUri } = body;

    if (!state || typeof state !== "string") {
      throw new BadRequestError("Missing state parameter");
    }

    if (!redirectUri || typeof redirectUri !== "string") {
      throw new BadRequestError("Missing redirectUri parameter");
    }

    // Validate redirect URI is a loopback address
    let parsedUri: URL;
    try {
      parsedUri = new URL(redirectUri);
    } catch {
      throw new BadRequestError("Invalid redirectUri");
    }

    if (!isLoopbackHost(parsedUri.hostname)) {
      throw new BadRequestError("Redirect URI must be a loopback address");
    }

    // Return a short-lived, single-use code. The CLI exchanges this code over
    // HTTPS so the bearer token never appears in browser history or logs.
    const code = await createCliAuthorizationCode(session.user.id, redirectUri);

    // Build redirect URL with only the one-time code and CSRF state.
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", state);

    return NextResponse.json({ redirectUrl: redirect.toString() });
  } catch (error) {
    return handleApiError(error);
  }
}
