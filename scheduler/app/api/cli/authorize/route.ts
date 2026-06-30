import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { assertPlanFeature } from "@/lib/billing/subscriptions";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

const CLI_TOKEN_PREFIX = "sp_cli_";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    await assertPlanFeature(session.user.id, "cliAccess");
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

    // Generate token
    const rawToken = CLI_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);

    await prisma.cliToken.create({
      data: {
        userId: session.user.id,
        tokenHash,
      },
    });

    // Build redirect URL with token, state, and user info
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("token", rawToken);
    redirect.searchParams.set("state", state);
    redirect.searchParams.set("user_id", session.user.id);
    if (session.user.email) {
      redirect.searchParams.set("user_email", session.user.email as string);
    }
    if (session.user.name) {
      redirect.searchParams.set("user_name", session.user.name as string);
    }

    return NextResponse.json({ redirectUrl: redirect.toString() });
  } catch (error) {
    return handleApiError(error);
  }
}
