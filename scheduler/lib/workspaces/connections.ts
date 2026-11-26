import { hasFeature } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError } from "@/lib/utils/errors";

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
