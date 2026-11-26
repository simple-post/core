import { type NextRequest, NextResponse } from "next/server";

import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { getReconnectImpact } from "@/lib/accounts/reconnect-impact";
import { localeFromRequestHeaders } from "@/lib/i18n/locales";
import { credentialStatusDisplay } from "@/lib/i18n/validation-display";
import { requireReadAuth } from "@/lib/middleware/auth";
import { getConnectedAccountCredentialStatus } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireReadAuth(req);

    const { userId, workspaceId, canManage } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
    );

    // Fetch user's connected social media accounts (for posting)
    const storedAccounts = await prisma.connectedAccount.findMany({
      where: {
        userId,
        workspaceId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const locale = localeFromRequestHeaders(req.headers);
    const connectedAccounts = storedAccounts.map((storedAccount) => {
      const account = decryptConnectedAccountSecrets(storedAccount);
      const { accessToken: _accessToken, refreshToken: _refreshToken, tokenMetadata, ...safeAccount } = account;
      const previewOnly = isPreviewOnlyTokenMetadata(tokenMetadata);

      return {
        ...safeAccount,
        ...(!canManage && { email: null, scope: null }),
        previewOnly,
        credentialStatus: credentialStatusDisplay(getConnectedAccountCredentialStatus(account), locale),
      };
    });
    const reconnectImpact = await getReconnectImpact(
      userId,
      connectedAccounts
        .filter((account) => account.credentialStatus.state === "reauth_required")
        .map((account) => account.id),
    );
    for (const account of connectedAccounts) {
      if (reconnectImpact.has(account.id))
        account.credentialStatus.affectedQueuedPosts = reconnectImpact.get(account.id);
    }

    return NextResponse.json(
      { accounts: connectedAccounts },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
