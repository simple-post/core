import { hasFeature } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/utils/errors";

import type { Tx } from "./access";
import type { Snapshot } from "./contracts";

/** Resolve ownership from membership on the server, never from client-supplied account IDs. */
export async function workspaceConnections(userId: string, workspaceId: string | null, write = false) {
  if (!workspaceId) return { userId, workspaceId: null, canManage: true };
  if (!(await hasFeature(userId, "TEAM_WORKSPACES"))) throw new NotFoundError("Workspace not found");
  const member = await prisma.teamMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, workspace: { select: { creatorId: true } } },
  });
  if (!member) throw new NotFoundError("Workspace not found");
  const canManage = member.role === "Admin" && member.workspace.creatorId === userId;
  if (write && !canManage) throw new ForbiddenError("Only the workspace owner can manage connections");
  return { userId: member.workspace.creatorId, workspaceId, canManage };
}

export async function requireWorkspaceDestinations(tx: Tx, workspaceId: string, ownerId: string, snapshot: Snapshot) {
  if (Date.parse(snapshot.plannedAt) <= Date.now())
    throw new ConflictError("Choose a future publication time before continuing.");
  const destinations = [];
  for (const variant of snapshot.variants) {
    if (!variant.accountId || !variant.destination)
      throw new ConflictError("Choose a connected workspace account for every platform in this post.");
    // Keep a disconnect or identity change from racing the review or delivery write.
    const [account] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "connected_account"
      WHERE id = ${variant.accountId} AND "workspaceId" = ${workspaceId} AND "userId" = ${ownerId}
        AND platform = ${variant.platform} AND "platformAccountId" = ${variant.destination.platformAccountId}
      FOR SHARE
    `;
    if (!account)
      throw new ConflictError("A selected account is unavailable. Choose an account connected to this workspace.");
    destinations.push({ variant, accountId: account.id });
  }
  return destinations;
}
