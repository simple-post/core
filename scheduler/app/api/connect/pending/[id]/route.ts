import { type NextRequest, NextResponse } from "next/server";

import { isSocialPlatformEnabled } from "@/lib/config";
import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth";
import { CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS } from "@/lib/oauth/connected-account-lock";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { handleApiError, BadRequestError, NotFoundError, GoneError } from "@/lib/utils/errors";

import type { Prisma } from "@prisma/client";

type PendingAccount = {
  id: string;
  name?: string | null;
  username?: string | null;
  profilePicture?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  email?: string | null;
  tokenMetadata?: Prisma.JsonValue | null;
  accountType?: string;
};

type PendingData = {
  accounts: PendingAccount[];
  scope?: string | null;
  warning?: string;
};

function sanitizeAccounts(accounts: PendingAccount[]) {
  return accounts.map(({ id, name, username, profilePicture, accountType }) => ({
    id,
    name,
    username,
    profilePicture,
    accountType,
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(_req, { action: "view_pending_social_accounts" });

    const pending = await prisma.pendingOAuthConnection.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!pending) {
      throw new NotFoundError("Pending connection not found");
    }

    if (!isSocialPlatformEnabled(pending.platform)) {
      throw new BadRequestError("Social platform is not enabled in this environment");
    }

    if (pending.expiresAt && pending.expiresAt.getTime() < Date.now()) {
      await prisma.pendingOAuthConnection.delete({ where: { id: pending.id } });
      throw new GoneError("Pending connection expired");
    }

    const data = pending.data as PendingData;
    if (!data || !Array.isArray(data.accounts)) {
      throw new BadRequestError("Invalid pending connection data");
    }

    return NextResponse.json({
      id: pending.id,
      platform: pending.platform,
      accounts: sanitizeAccounts(data.accounts),
      warning: data.warning,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req, { action: "connect_pending_social_accounts" });
    const body = await req.json();
    const selectedAccountIds = Array.isArray(body.selectedAccountIds) ? body.selectedAccountIds : [];

    if (selectedAccountIds.length === 0) {
      throw new BadRequestError("Select at least one account");
    }

    const pending = await prisma.pendingOAuthConnection.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!pending) {
      throw new NotFoundError("Pending connection not found");
    }

    if (!isSocialPlatformEnabled(pending.platform)) {
      throw new BadRequestError("Social platform is not enabled in this environment");
    }

    if (pending.expiresAt && pending.expiresAt.getTime() < Date.now()) {
      await prisma.pendingOAuthConnection.delete({ where: { id: pending.id } });
      throw new GoneError("Pending connection expired");
    }

    const data = pending.data as PendingData;
    if (!data || !Array.isArray(data.accounts)) {
      throw new BadRequestError("Invalid pending connection data");
    }

    const selectedAccounts = data.accounts.filter((account) => selectedAccountIds.includes(account.id));
    if (
      selectedAccounts.length === 0 ||
      selectedAccountIds.some(
        (id: unknown) => typeof id !== "string" || !data.accounts.some((account) => account.id === id),
      )
    ) {
      throw new BadRequestError("Selected accounts not found");
    }

    const scope = data.scope || null;

    await prisma.$transaction(async (tx) => {
      for (const account of selectedAccounts) {
        const displayName = account.name || account.username || account.id;
        const username =
          pending.platform === "instagram" || pending.platform === "linkedin" ? account.username || null : null;
        const credentials =
          pending.platform === "linkedin"
            ? decryptConnectedAccountSecrets({
                ...account,
                refreshToken: account.refreshToken ?? null,
                tokenMetadata: account.tokenMetadata ?? null,
              })
            : account;

        await upsertConnectedAccount(
          {
            userId: session.user.id,
            platform: pending.platform,
            platformAccountId: account.id,
            accessToken: credentials.accessToken,
            refreshToken: credentials.refreshToken ?? null,
            expiresAt: account.expiresAt ? new Date(account.expiresAt) : null,
            scope,
            username,
            displayName,
            email: account.email ?? null,
            profilePicture: account.profilePicture || null,
            tokenMetadata:
              credentials.tokenMetadata == null ? undefined : (credentials.tokenMetadata as Prisma.InputJsonValue),
          },
          tx,
        );
      }

      await tx.pendingOAuthConnection.delete({ where: { id: pending.id } });
    }, CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS);

    return NextResponse.json({ success: true, count: selectedAccounts.length });
  } catch (error) {
    return handleApiError(error);
  }
}
