import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

type PendingAccount = {
  id: string;
  name?: string | null;
  username?: string | null;
  profilePicture?: string | null;
  accessToken: string;
};

type PendingData = {
  accounts: PendingAccount[];
  scope?: string | null;
};

function sanitizeAccounts(accounts: PendingAccount[]) {
  return accounts.map(({ id, name, username, profilePicture }) => ({
    id,
    name,
    username,
    profilePicture,
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(_req);
    const { id } = await params;

    const pending = await prisma.pendingOAuthConnection.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!pending) {
      return NextResponse.json({ error: "Pending connection not found" }, { status: 404 });
    }

    if (pending.expiresAt && pending.expiresAt.getTime() < Date.now()) {
      await prisma.pendingOAuthConnection.delete({ where: { id: pending.id } });
      return NextResponse.json({ error: "Pending connection expired" }, { status: 410 });
    }

    const data = pending.data as PendingData;
    if (!data || !Array.isArray(data.accounts)) {
      throw new BadRequestError("Invalid pending connection data");
    }

    return NextResponse.json({
      id: pending.id,
      platform: pending.platform,
      accounts: sanitizeAccounts(data.accounts),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
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
      return NextResponse.json({ error: "Pending connection not found" }, { status: 404 });
    }

    if (pending.expiresAt && pending.expiresAt.getTime() < Date.now()) {
      await prisma.pendingOAuthConnection.delete({ where: { id: pending.id } });
      return NextResponse.json({ error: "Pending connection expired" }, { status: 410 });
    }

    const data = pending.data as PendingData;
    if (!data || !Array.isArray(data.accounts)) {
      throw new BadRequestError("Invalid pending connection data");
    }

    const selectedAccounts = data.accounts.filter((account) => selectedAccountIds.includes(account.id));
    if (selectedAccounts.length === 0) {
      throw new BadRequestError("Selected accounts not found");
    }

    const scope = data.scope || null;

    await prisma.$transaction(async (tx) => {
      for (const account of selectedAccounts) {
        const displayName = account.name || account.username || account.id;
        const username = pending.platform === "instagram" ? account.username || null : null;

        await tx.connectedAccount.upsert({
          where: {
            userId_platform_platformAccountId: {
              userId: session.user.id,
              platform: pending.platform,
              platformAccountId: account.id,
            },
          },
          create: encryptConnectedAccountSecrets({
            userId: session.user.id,
            platform: pending.platform,
            platformAccountId: account.id,
            accessToken: account.accessToken,
            refreshToken: null,
            expiresAt: null,
            scope,
            username,
            displayName,
            email: null,
            profilePicture: account.profilePicture || null,
          }),
          update: {
            ...encryptConnectedAccountSecrets({ accessToken: account.accessToken, refreshToken: null }),
            scope,
            username,
            displayName,
            profilePicture: account.profilePicture || null,
            updatedAt: new Date(),
          },
        });
      }

      await tx.pendingOAuthConnection.delete({ where: { id: pending.id } });
    });

    return NextResponse.json({ success: true, count: selectedAccounts.length });
  } catch (error) {
    return handleApiError(error);
  }
}
