import type { PrismaClient } from "@prisma/client";

type AdvisoryLockClient = Pick<PrismaClient, "$queryRaw">;

export const CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 45_000,
} as const;

/**
 * Serializes credential changes for one connected account across every
 * scheduler process sharing the same PostgreSQL database.
 *
 * This must be called inside a transaction. Transaction-scoped advisory locks
 * are released automatically on commit, rollback, or connection loss, so a
 * crashed worker cannot leave a stale lease behind.
 */
export async function acquireConnectedAccountCredentialLock(
  client: AdvisoryLockClient,
  accountId: string,
): Promise<void> {
  const lockKey = `simplepost:connected-account-credentials:${accountId}`;
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
