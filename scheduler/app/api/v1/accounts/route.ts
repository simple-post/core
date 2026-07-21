import { type NextRequest, NextResponse } from "next/server";

import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { requireAuth } from "@/lib/middleware/auth";
import { getConnectedAccountCredentialStatus } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Fetch user's connected social media accounts (for posting)
    const storedAccounts = await prisma.connectedAccount.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const connectedAccounts = storedAccounts.map((storedAccount) => {
      const account = decryptConnectedAccountSecrets(storedAccount);
      const { accessToken: _accessToken, refreshToken: _refreshToken, tokenMetadata, ...safeAccount } = account;
      const previewOnly = isPreviewOnlyTokenMetadata(tokenMetadata);

      return {
        ...safeAccount,
        previewOnly,
        credentialStatus: getConnectedAccountCredentialStatus(account),
      };
    });

    return NextResponse.json(
      { accounts: connectedAccounts },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
