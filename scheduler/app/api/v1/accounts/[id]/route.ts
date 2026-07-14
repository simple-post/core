import { type NextRequest, NextResponse } from "next/server";

import { FarcasterProtocolError, revokeFarcasterSigner } from "@/lib/farcaster/snapchain";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { ApiError, handleApiError, NotFoundError, ForbiddenError } from "@/lib/utils/errors";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    // Check if the account exists and belongs to the user
    const account = await prisma.connectedAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (account.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to delete this account");
    }

    const decryptedAccount = decryptConnectedAccountSecrets(account);
    const metadata =
      decryptedAccount.tokenMetadata &&
      typeof decryptedAccount.tokenMetadata === "object" &&
      !Array.isArray(decryptedAccount.tokenMetadata)
        ? (decryptedAccount.tokenMetadata as Record<string, unknown>)
        : {};
    if (account.platform.toLowerCase() === "farcaster" && metadata.protocol === "snapchain-key-add-v1") {
      try {
        await revokeFarcasterSigner(Number(account.platformAccountId), decryptedAccount.accessToken);
      } catch (error) {
        if (error instanceof FarcasterProtocolError) {
          throw new ApiError(
            `The Farcaster signer could not be revoked, so the account was not deleted: ${error.message}`,
            502,
            "FARCASTER_REVOCATION_FAILED",
          );
        }
        throw error;
      }
    }

    await prisma.connectedAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Account disconnected successfully" });
  } catch (error) {
    return handleApiError(error);
  }
}
