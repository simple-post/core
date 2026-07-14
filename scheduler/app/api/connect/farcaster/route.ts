import { type NextRequest, NextResponse } from "next/server";

import { assertCanConnectAccount } from "@/lib/billing/subscriptions";
import { isSocialPlatformEnabled } from "@/lib/config";
import {
  completeFarcasterConnection,
  FarcasterProtocolError,
  prepareFarcasterConnection,
  revokeFarcasterSigner,
} from "@/lib/farcaster/snapchain";
import { createLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { FarcasterConnectRequestSchema } from "@/lib/openapi/schemas";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

const log = createLogger("farcaster-connect");

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (!isSocialPlatformEnabled("farcaster")) {
      throw new BadRequestError("Farcaster is not enabled for this deployment");
    }
    const body = FarcasterConnectRequestSchema.parse(await request.json());

    if (body.action === "prepare") {
      const prepared = await prepareFarcasterConnection(session.user.id, body.custodyAddress);
      await assertCanConnectAccount({
        userId: session.user.id,
        platform: "farcaster",
        platformAccountId: String(prepared.fid),
      });
      return NextResponse.json({ action: "sign", ...prepared });
    }

    const connected = await completeFarcasterConnection(session.user.id, body.requestToken, body.custodySignature);
    let previousAccount;
    try {
      previousAccount = await prisma.connectedAccount.findUnique({
        where: {
          userId_platform_platformAccountId: {
            userId: session.user.id,
            platform: "farcaster",
            platformAccountId: String(connected.fid),
          },
        },
      });

      await upsertConnectedAccount({
        userId: session.user.id,
        platform: "farcaster",
        platformAccountId: String(connected.fid),
        accessToken: connected.signerPrivateKey,
        refreshToken: null,
        expiresAt: connected.expiresAt,
        scope: "cast:add cast:remove",
        username: connected.username,
        displayName: connected.username ? `@${connected.username}` : `FID ${connected.fid}`,
        email: null,
        profilePicture: null,
        tokenMetadata: {
          protocol: "snapchain-key-add-v1",
          custodyAddress: connected.custodyAddress,
          signerPublicKey: connected.signerPublicKey,
          requestFid: connected.requestFid,
          scopes: connected.scopes,
          ttl: connected.ttl,
        },
      });
    } catch (error) {
      try {
        await revokeFarcasterSigner(connected.fid, connected.signerPrivateKey);
      } catch (cleanupError) {
        log.error(
          { err: serializeError(cleanupError), fid: connected.fid },
          "Could not revoke a newly registered signer after account persistence failed",
        );
      }
      throw error;
    }

    const previousSigner = previousAccount ? decryptConnectedAccountSecrets(previousAccount).accessToken : null;

    if (previousSigner && previousSigner.toLowerCase() !== connected.signerPrivateKey.toLowerCase()) {
      try {
        await revokeFarcasterSigner(connected.fid, previousSigner);
      } catch (error) {
        // The old signer is no longer used and will expire after its bounded TTL.
        log.warn(
          { err: serializeError(error), fid: connected.fid, accountId: previousAccount?.id },
          "Connected a replacement signer but could not revoke the previous signer",
        );
      }
    }

    return NextResponse.json({ success: true, fid: connected.fid, username: connected.username });
  } catch (error) {
    if (error instanceof FarcasterProtocolError) return handleApiError(new BadRequestError(error.message));
    return handleApiError(error);
  }
}
