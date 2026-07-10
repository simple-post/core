import { assertCanConnectAccount, lockUserForQuota } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

import type { Prisma, PrismaClient } from "@prisma/client";

export interface UpsertAccountData {
  userId: string;
  platform: string;
  platformAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  username: string | null;
  displayName: string | null;
  email: string | null;
  profilePicture: string | null;
  tokenMetadata?: Prisma.InputJsonValue;
}

type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function upsertConnectedAccount(data: UpsertAccountData, tx?: TransactionClient): Promise<void> {
  if (!tx) {
    await prisma.$transaction(async (transaction) => {
      await upsertConnectedAccount(data, transaction);
    });
    return;
  }

  const client = tx;

  await lockUserForQuota(client, data.userId);

  await assertCanConnectAccount(
    {
      userId: data.userId,
      platform: data.platform,
      platformAccountId: data.platformAccountId,
    },
    client,
  );

  await client.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: data.userId,
        platform: data.platform,
        platformAccountId: data.platformAccountId,
      },
    },
    create: encryptConnectedAccountSecrets({
      userId: data.userId,
      platform: data.platform,
      platformAccountId: data.platformAccountId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      scope: data.scope,
      username: data.username,
      displayName: data.displayName,
      email: data.email,
      profilePicture: data.profilePicture,
      tokenMetadata: data.tokenMetadata,
    }),
    update: {
      ...encryptConnectedAccountSecrets({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenMetadata: data.tokenMetadata,
      }),
      expiresAt: data.expiresAt,
      scope: data.scope,
      username: data.username,
      displayName: data.displayName,
      email: data.email,
      profilePicture: data.profilePicture,
      updatedAt: new Date(),
    },
  });
}
