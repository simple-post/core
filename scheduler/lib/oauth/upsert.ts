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
  workspaceId?: string;
  reconnectAccountId?: string;
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

  const identity = {
    userId: data.userId,
    workspaceId: data.workspaceId ?? null,
    platform: data.platform,
    platformAccountId: data.platformAccountId,
  };
  // Check again inside the write transaction after the OAuth round trip.
  if (
    data.workspaceId &&
    !(await client.teamWorkspace.findFirst({
      where: {
        id: data.workspaceId,
        creatorId: data.userId,
        members: { some: { userId: data.userId, role: "Admin" } },
      },
      select: { id: true },
    }))
  )
    throw new OAuthCallbackError("invalid_state", "Workspace is unavailable.");

  if (data.previousIdentity && !(await client.connectedAccount.findFirst({ where: identity, select: { id: true } }))) {
    const previous = { ...identity, platformAccountId: data.previousIdentity.platformAccountId };
    const legacyAccount = await client.connectedAccount.findFirst({ where: previous, select: { id: true } });
    if (!legacyAccount)
      throw new OAuthCallbackError("profile_fetch_failed", "Legacy account changed. Please connect again.");
    await acquireConnectedAccountCredentialLock(client, legacyAccount.id);
    const migrated = await client.connectedAccount.updateMany({
      where: { ...previous, id: legacyAccount.id, updatedAt: data.previousIdentity.updatedAt },
      data: { platformAccountId: data.platformAccountId },
    });
    if (migrated.count !== 1)
      throw new OAuthCallbackError("profile_fetch_failed", "Legacy account changed. Please connect again.");
  }

  // Reconnects replace the complete credential set. Serialize them with token
  // refreshes so a refresh that started with an old single-use token cannot
  // overwrite the newly authorized session.
  const existingAccount = await client.connectedAccount.findFirst({
    where: {
      ...identity,
      ...(data.reconnectAccountId && { id: data.reconnectAccountId }),
      ...(data.reconnectAccountId && data.platform === "x" && { platform: { in: ["x", "twitter"] } }),
    },
    select: { id: true, platform: true },
  });
  if (data.reconnectAccountId && existingAccount?.id !== data.reconnectAccountId)
    throw new OAuthCallbackError("reconnect_account_mismatch", "Choose the same account to reconnect.");
  await assertCanConnectAccount(
    {
      ...identity,
      platform: existingAccount?.platform ?? identity.platform,
      accountLabel: data.username ?? data.displayName ?? data.platformAccountId,
    },
    client,
  );
  if (existingAccount) {
    await acquireConnectedAccountCredentialLock(client, existingAccount.id);
  }

  const encryptedCredentials = encryptConnectedAccountSecrets({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    tokenMetadata: data.tokenMetadata,
  });

  const profile = {
    expiresAt: data.expiresAt,
    scope: data.scope,
    username: data.username,
    displayName: data.displayName,
    email: data.email,
    profilePicture: data.profilePicture,
  };
  if (existingAccount) {
    await client.connectedAccount.update({
      where: { id: existingAccount.id },
      data: {
        ...encryptedCredentials,
        ...profile,
        tokenMetadata: encryptedCredentials.tokenMetadata ?? Prisma.DbNull,
        credentialRefreshBlockedAt: null,
        credentialRefreshRetryAt: null,
      },
    });
    await client.socialActivitySync.updateMany({
      where: { accountId: existingAccount.id },
      data: {
        lastError: null,
        lastErrorCode: null,
        lastAttemptAt: null,
        retryAt: null,
        leaseToken: null,
        leaseUntil: null,
      },
    });
    await client.postAnalytics.updateMany({
      where: { accountId: existingAccount.id, status: { in: ["missing_permission", "credentials_error"] } },
      data: { status: "pending", nextRefreshAt: new Date(), leaseToken: null, leaseUntil: null, message: null },
    });
  } else {
    await client.connectedAccount.create({ data: { ...identity, ...encryptedCredentials, ...profile } });
  }
}
