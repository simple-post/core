import { type NextRequest, NextResponse } from "next/server";

import { getNostrPublicKey } from "@simple-post/sdk";

import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const privateKey = typeof body.privateKey === "string" ? body.privateKey.trim() : "";
    const relayValues: string[] = Array.isArray(body.relays)
      ? body.relays.filter((relay: unknown): relay is string => typeof relay === "string")
      : [];
    const relays: string[] = [...new Set(relayValues.map((relay) => relay.trim()).filter(Boolean))];
    if (!privateKey || relays.length === 0 || relays.some((relay) => !/^wss:\/\//i.test(relay)))
      throw new BadRequestError("A private key and at least one wss:// relay are required");
    let publicKey: string;
    try {
      publicKey = getNostrPublicKey(privateKey);
    } catch {
      throw new BadRequestError("Private key must be a valid nsec or 64-character hex key");
    }
    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "nostr",
      platformAccountId: publicKey,
      accessToken: privateKey,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      username: null,
      displayName: `npub ${publicKey.slice(0, 12)}…`,
      email: null,
      profilePicture: null,
      tokenMetadata: { relays },
    });
    return NextResponse.json({ success: true, account: { platform: "nostr", publicKey } });
  } catch (error) {
    return handleApiError(error);
  }
}
