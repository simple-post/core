import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { POST_CREDENTIAL_MIN_VALIDITY_MS, refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { fetchTikTokCreatorInfo } from "@/lib/tiktok/creator-info";
import { handleApiError, NotFoundError, ForbiddenError, BadRequestError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    const storedAccount = await prisma.connectedAccount.findUnique({ where: { id } });
    const account = storedAccount ? decryptConnectedAccountSecrets(storedAccount) : null;

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (account.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to access this account");
    }

    if (account.platform.toLowerCase() !== "tiktok") {
      throw new BadRequestError("This endpoint only supports TikTok accounts");
    }

    // TikTok rotates refresh tokens; the lock keeps this refresh from racing
    // a concurrent publish for the same account.
    const refreshResult = await withAccountLock(account.id, async () => {
      const freshAccount = await reloadAccountSecrets(account);
      return refreshConnectedAccountIfNeeded(freshAccount, {
        minValidityMs: POST_CREDENTIAL_MIN_VALIDITY_MS,
        reason: "post",
      });
    });
    if (refreshResult.error) {
      throw new BadRequestError(refreshResult.error);
    }
    const creatorInfo = await fetchTikTokCreatorInfo(refreshResult.account.accessToken);

    return NextResponse.json(
      { creatorInfo },
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
