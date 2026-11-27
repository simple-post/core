import { type Prisma } from "@prisma/client";

import { lockUserForQuota } from "@/lib/billing/subscriptions";
import { ConflictError } from "@/lib/utils/errors";

import { authorize, membership, type Tx } from "./access";

/** Acquire quota locks before the workspace lock, in the same order as release. */
export async function prepareOwnerRemoval(tx: Tx, workspaceId: string, actorId: string, targetId: string) {
  const actor = await membership(tx, workspaceId, actorId);
  authorize(actor, "admin");
  const workspace = await tx.teamWorkspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { creatorId: true },
  });
  if (workspace.creatorId !== targetId) return undefined;
  const next =
    actorId === targetId
      ? await tx.teamMember.findFirst({
          where: { workspaceId, userId: { not: targetId }, role: "Admin" },
          orderBy: { userId: "asc" },
        })
      : actor;
  if (!next) return undefined;
  for (const userId of [targetId, next.userId].sort()) await lockUserForQuota(tx, userId);
  return next.userId;
}

export async function transferWorkspaceOwnership(tx: Tx, workspaceId: string, previous: string, successor: string) {
  const posts = {
    userId: previous,
    OR: [
      { workspaceReview: { post: { workspaceId } } },
      { accounts: { some: { workspaceId }, every: { workspaceId } } },
    ],
  } satisfies Prisma.PostWhereInput;
  const idle = { status: { not: "pending" }, repostStatus: { not: "pending" } };
  await tx.post.updateMany({
    where: { ...posts, ...idle, storageOwnerId: null },
    data: { storageOwnerId: previous, userId: successor, idempotencyKey: null },
  });
  await tx.post.updateMany({
    where: { ...posts, ...idle },
    data: { userId: successor, idempotencyKey: null },
  });
  if (await tx.post.findFirst({ where: posts, select: { id: true } }))
    throw new ConflictError("Wait for the workspace’s current publishing run to finish, then try again.");

  const accounts = { workspaceId, userId: previous };
  await tx.postAnalytics.updateMany({
    where: { account: accounts },
    data: { userId: successor, leaseToken: null, leaseUntil: null },
  });
  await tx.postAnalyticsSnapshot.updateMany({
    where: { analytics: { account: accounts } },
    data: { userId: successor },
  });
  await tx.accountAnalyticsSnapshot.updateMany({
    where: { account: accounts },
    data: { userId: successor },
  });
  await tx.socialActivitySync.updateMany({
    where: { account: accounts },
    data: { leaseToken: null, leaseUntil: null },
  });
  await tx.socialActivityItem.updateMany({
    where: { account: accounts },
    data: { userId: successor },
  });
  // Preserve history and retire the original account's user-scoped retry keys.
  await tx.$executeRaw`
    UPDATE "social_activity_reply" AS reply
    SET "userId" = ${successor}, "idempotencyKey" = 'transferred:' || reply.id
    FROM "connected_account" AS account
    WHERE reply."accountId" = account.id
      AND account."workspaceId" = ${workspaceId} AND account."userId" = ${previous}
  `;
  await tx.accountDisconnectNotification.updateMany({
    where: { account: accounts, status: "pending" },
    data: { status: "cancelled", leaseToken: null, leaseUntil: null },
  });
  await tx.connectedAccount.updateMany({ where: accounts, data: { userId: successor } });
  await tx.teamWorkspace.update({ where: { id: workspaceId }, data: { creatorId: successor } });
}
