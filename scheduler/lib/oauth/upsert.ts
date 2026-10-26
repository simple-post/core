import { Prisma, type PrismaClient } from "@prisma/client";

import { assertCanConnectAccount, lockUserForQuota } from "@/lib/billing/subscriptions";
import {
  acquireConnectedAccountCredentialLock,
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS,
} from "@/lib/oauth/connected-account-lock";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

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
  /** Only supply after verifying the old credentials authorize the same platform identity. */
  previousIdentity?: { platformAccountId: string; updatedAt: Date };
}

type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function upsertConnectedAccount(data: UpsertAccountData, tx?: TransactionClient): Promise<void> {
  if (!tx) {
    await prisma.$transaction(async (transaction) => {
      await upsertConnectedAccount(data, transaction);
    }, CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS);
    return;
  }

  const client = tx;

  // Always acquire the per-user quota lock before an account advisory lock.
  // Multi-account picker callbacks run these upserts in one transaction; a
  // consistent lock order prevents two reconnect requests from deadlocking.
  await lockUserForQuota(client, data.userId);

  if (data.previousIdentity) {
    const canonicalAccount = await client.connectedAccount.findUnique({
      where: {
        userId_platform_platformAccountId: {
          userId: data.userId,
          platform: data.platform,
          platformAccountId: data.platformAccountId,
        },
      },
      select: { id: true },
    });
    if (!canonicalAccount) {
      const legacyAccount = await client.connectedAccount.findUnique({
        where: {
          userId_platform_platformAccountId: {
            userId: data.userId,
            platform: data.platform,
            platformAccountId: data.previousIdentity.platformAccountId,
          },
        },
        select: { id: true },
      });
      if (!legacyAccount) {
        throw new OAuthCallbackError("profile_fetch_failed", "Legacy account changed. Please connect again.");
      }
      await acquireConnectedAccountCredentialLock(client, legacyAccount.id);
      const migrated = await client.connectedAccount.updateMany({
        where: {
          id: legacyAccount.id,
          userId: data.userId,
          platform: data.platform,
          platformAccountId: data.previousIdentity.platformAccountId,
          updatedAt: data.previousIdentity.updatedAt,
        },
        data: { platformAccountId: data.platformAccountId },
      });
      if (migrated.count !== 1) {
        throw new OAuthCallbackError("profile_fetch_failed", "Legacy account changed. Please connect again.");
      }
    }
  }

  await assertCanConnectAccount(
    {
      userId: data.userId,
      platform: data.platform,
      platformAccountId: data.platformAccountId,
      accountLabel: data.username ?? data.displayName ?? data.platformAccountId,
    },
    client,
  );

  // Reconnects replace the complete credential set. Serialize them with token
  // refreshes so a refresh that started with an old single-use token cannot
  // overwrite the newly authorized session.
  const existingAccount = await client.connectedAccount.findUnique({
    where: {
      userId_platform_platformAccountId: {
        userId: data.userId,
        platform: data.platform,
        platformAccountId: data.platformAccountId,
      },
    },
    select: { id: true },
  });
  if (existingAccount) {
    await acquireConnectedAccountCredentialLock(client, existingAccount.id);
  }

  const encryptedCredentials = encryptConnectedAccountSecrets({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    tokenMetadata: data.tokenMetadata,
  });

  await client.connectedAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: data.userId,
        platform: data.platform,
        platformAccountId: data.platformAccountId,
      },
    },
    create: {
      userId: data.userId,
      platform: data.platform,
      platformAccountId: data.platformAccountId,
      ...encryptedCredentials,
      expiresAt: data.expiresAt,
      scope: data.scope,
      username: data.username,
      displayName: data.displayName,
      email: data.email,
      profilePicture: data.profilePicture,
    },
    update: {
      ...encryptedCredentials,
      // `undefined` means "leave unchanged" to Prisma. A reconnect without
      // provider metadata must instead clear old DPoP keys/error state.
      tokenMetadata: encryptedCredentials.tokenMetadata ?? Prisma.DbNull,
      credentialRefreshBlockedAt: null,
      credentialRefreshRetryAt: null,
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
