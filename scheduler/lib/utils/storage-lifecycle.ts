import { deleteFromStorage, getOwnedStorageKeyFromUrl } from "@simple-post/sdk";

import { lockUserForQuota } from "@/lib/billing/subscriptions";
import { mediaLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/utils/errors";

import type { Prisma } from "@prisma/client";

const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Includes URLs in root media, thumbnails, options, overrides and nested threads. */
export function collectStorageKeys(userId: string, value: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      const key = getOwnedStorageKeyFromUrl(item, userId);
      if (key) keys.add(key);
    } else if (Array.isArray(item)) item.forEach((entry) => visit(entry));
    else if (item && typeof item === "object") Object.values(item).forEach((entry) => visit(entry));
  };
  visit(value);
  return keys;
}

// Caller holds the same user-row lock as collection through the save commit.
export async function assertStorageAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
  value: unknown,
): Promise<void> {
  const keys = [...collectStorageKeys(userId, value)];
  if (keys.length === 0) return;
  const unavailable = await tx.storageDeletion.findFirst({
    where: { key: { in: keys }, state: { in: ["deleting", "deleted"] } },
  });
  if (unavailable)
    throw new ConflictError("Some media has expired or been deleted. Upload it again before saving this post.");
}

export async function queueStorageDeletion(
  tx: Prisma.TransactionClient,
  userId: string,
  value: unknown,
): Promise<void> {
  for (const key of collectStorageKeys(userId, value)) {
    await tx.storageDeletion.upsert({
      where: { key },
      create: { key, userId, dueAt: new Date(Date.now() + RETENTION_MS) },
      update: {},
    });
  }
}

export async function collectUnusedStorage(): Promise<void> {
  const deadline = Date.now() + 30_000;
  const candidates = await prisma.storageDeletion.findMany({
    where: { state: { in: ["queued", "deleting"] }, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        await lockUserForQuota(tx, candidate.userId);
        const current = await tx.storageDeletion.findUnique({ where: { key: candidate.key } });
        if (!current || current.state === "deleted") return false;
        const posts = await tx.post.findMany({
          where: { userId: candidate.userId },
          select: { media: true, thread: true, accountOptions: true, accountOverrides: true },
        });
        if (collectStorageKeys(candidate.userId, posts).has(candidate.key)) {
          await tx.storageDeletion.update({
            where: { key: candidate.key },
            data: { dueAt: new Date(Date.now() + RETENTION_MS) },
          });
          return false;
        }
        await tx.storageDeletion.update({ where: { key: candidate.key }, data: { state: "deleting" } });
        return true;
      });
      if (!claimed) continue;
      // A durable tombstone now prevents a concurrent save from reviving this key.
      // Deletion is idempotent; interrupted attempts are picked up by the next sweep.
      await deleteFromStorage(candidate.key, { timeoutMs: Math.max(1, Math.min(5000, deadline - Date.now())) });
      await prisma.storageDeletion.update({ where: { key: candidate.key }, data: { state: "deleted" } });
    } catch (error) {
      mediaLogger.error({ err: serializeError(error), key: candidate.key }, "Storage collection failed; will retry");
      await prisma.storageDeletion
        .updateMany({
          where: { key: candidate.key, state: { not: "deleted" } },
          data: { dueAt: new Date(Date.now() + 300_000) },
        })
        .catch(() => undefined);
    }
  }
}
