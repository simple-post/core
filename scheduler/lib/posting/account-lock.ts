import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

/**
 * In-process serialization of publishing per connected account.
 *
 * X and TikTok rotate refresh tokens on every refresh: two concurrent
 * publishes for the same account would both refresh with the same (stale)
 * refresh token, which the platforms treat as token reuse and may answer by
 * invalidating the whole token family — silently disconnecting the account.
 *
 * The lock serializes publishes per account; combined with
 * reloadAccountSecrets (called after acquiring the lock) the second publish
 * sees the tokens persisted by the first instead of its stale snapshot.
 *
 * Note: this protects a single process. Deployments running multiple app
 * replicas must route dispatching through one instance (the documented
 * single-cron setup) or add a cross-process lock.
 */

const accountQueues = new Map<string, Promise<unknown>>();

export async function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const previous = accountQueues.get(accountId) ?? Promise.resolve();

  // Chain onto the queue tail regardless of whether the previous task failed.
  const task = previous.then(fn, fn);

  // Track the queue tail; clean up when we are still the tail at completion.
  const tail = task.then(
    () => undefined,
    () => undefined,
  );
  accountQueues.set(accountId, tail);
  void tail.then(() => {
    if (accountQueues.get(accountId) === tail) {
      accountQueues.delete(accountId);
    }
  });

  return task;
}

/**
 * Re-reads an account's credentials from the database, merging them over the
 * in-memory snapshot. Must be called after acquiring the account lock so a
 * publish that waited on the lock uses tokens refreshed by the previous
 * publish instead of a stale, already-rotated refresh token.
 */
export async function reloadAccountSecrets(account: ConnectedAccount): Promise<ConnectedAccount> {
  const stored = await prisma.connectedAccount.findUnique({ where: { id: account.id } });
  if (!stored) {
    return account;
  }

  const fresh = decryptConnectedAccountSecrets(stored);
  return {
    ...account,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    tokenMetadata: fresh.tokenMetadata,
    expiresAt: fresh.expiresAt,
  };
}
