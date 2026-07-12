import { type NextRequest, NextResponse } from "next/server";

import { createLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";
import { assertSafeRemoteUrl, assertValidWebhookUrl } from "@/lib/webhooks";

const log = createLogger("api:connect:mastodon");

interface MastodonProfile {
  id?: string;
  username?: string;
  acct?: string;
  display_name?: string;
  avatar?: string;
}

function normalizeInstanceUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestError("Instance URL is required");
  const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  assertValidWebhookUrl(withProtocol);
  const url = new URL(withProtocol);
  if (url.protocol !== "https:") throw new BadRequestError("Mastodon instance URL must use HTTPS");
  return url.origin;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const instanceUrl = normalizeInstanceUrl(body.instanceUrl);
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    if (!accessToken) throw new BadRequestError("Access token is required");
    await assertSafeRemoteUrl(instanceUrl);

    const response = await fetch(`${instanceUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const profile = (await response.json().catch(() => ({}))) as MastodonProfile & { error?: string };
    if (!response.ok || !profile.id || !profile.username) {
      throw new BadRequestError(profile.error || "Mastodon rejected these credentials");
    }

    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "mastodon",
      platformAccountId: `${profile.id}@${new URL(instanceUrl).host}`,
      accessToken,
      refreshToken: null,
      expiresAt: null,
      scope: "write:statuses write:media read:accounts",
      username: `${profile.username}@${new URL(instanceUrl).host}`,
      displayName: profile.display_name || profile.username,
      email: null,
      profilePicture: profile.avatar || null,
      tokenMetadata: { instanceUrl },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (!(error instanceof BadRequestError)) log.error({ err: serializeError(error) }, "Mastodon connect failed");
    return handleApiError(error);
  }
}
