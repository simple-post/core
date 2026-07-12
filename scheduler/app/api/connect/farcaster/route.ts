import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const fid = Number(body.fid);
    const key = typeof body.signerPrivateKey === "string" ? body.signerPrivateKey.trim() : "";
    const hubUrl = typeof body.hubUrl === "string" ? body.hubUrl.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";
    if (!Number.isInteger(fid) || fid <= 0 || !/^(0x)?[a-fA-F0-9]{64}$/.test(key) || !hubUrl)
      throw new BadRequestError("A positive FID, 32-byte hex signer key, and Hub endpoint are required");
    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "farcaster",
      platformAccountId: String(fid),
      accessToken: key,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      username: username || null,
      displayName: username ? `@${username}` : `FID ${fid}`,
      email: null,
      profilePicture: null,
      tokenMetadata: { hubUrl },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
