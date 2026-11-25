import { BadRequestError, ConflictError, NotFoundError } from "@/lib/utils/errors";

import type { Tx } from "./access";
import type { WorkspaceCommand } from "./contracts";

type Settings = Extract<
  WorkspaceCommand,
  { action: "settings" | "member" | "invite" | "revoke" | "remove" | "state" | "deleteState" | "removeFile" }
>;
export async function changeSettings(tx: Tx, workspaceId: string, cmd: Settings) {
  const workspace = await tx.teamWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
  switch (cmd.action) {
    case "settings": {
      return tx.teamWorkspace.update({
        where: { id: workspaceId },
        data: { name: cmd.name, icon: cmd.icon, description: cmd.description },
      });
    }
    case "removeFile": {
      // The caller holds the same workspace lock as edits and review creation.
      const where = { array_contains: [{ fileIds: [cmd.fileId] }] };
      const [post, review] = await Promise.all([
        tx.teamPost.findFirst({ where: { workspaceId, variants: where }, select: { id: true } }),
        tx.teamReview.findFirst({
          where: { post: { workspaceId }, snapshot: { path: ["variants"], ...where } },
          select: { id: true },
        }),
      ]);
      if (post || review) throw new ConflictError("This file belongs to a post or a retained review version");
      return tx.teamFile.deleteMany({ where: { workspaceId, id: cmd.fileId } });
    }
    case "invite": {
      if (
        await tx.teamMember.findFirst({
          where: { workspaceId, user: { email: { equals: cmd.email, mode: "insensitive" } } },
        })
      )
        throw new ConflictError("Already a member");
      await tx.teamInvite.deleteMany({ where: { workspaceId, email: cmd.email } });
      return tx.teamInvite.create({
        data: {
          workspaceId,
          email: cmd.email,
          role: cmd.role,
          approver: cmd.approver,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
    }
    case "revoke": {
      return tx.teamInvite.deleteMany({ where: { workspaceId, id: cmd.inviteId } });
    }
    case "member":
    case "remove": {
      if (cmd.userId === workspace.creatorId && (cmd.action === "remove" || cmd.role !== "Admin"))
        throw new BadRequestError("The workspace creator must remain an Admin");
      const where = { workspaceId_userId: { workspaceId, userId: cmd.userId } };
      if (!(await tx.teamMember.findUnique({ where, select: { userId: true } })))
        throw new NotFoundError("Member not found");
      if (cmd.action === "member")
        return tx.teamMember.update({ where, data: { role: cmd.role, approver: cmd.approver } });
      await tx.teamPost.updateMany({
        where: { workspaceId, ownerId: cmd.userId },
        data: { ownerId: null, revision: { increment: 1 } },
      });
      return tx.teamMember.delete({ where });
    }
    case "state":
    case "deleteState": {
      const current = cmd.stateId
        ? await tx.teamState.findUnique({ where: { workspaceId_id: { workspaceId, id: cmd.stateId } } })
        : null;
      if (cmd.stateId && !current) throw new NotFoundError("State not found");
      if (cmd.action === "deleteState") {
        if (current?.kind !== "custom" || (await tx.teamPost.count({ where: { workspaceId, stateId: cmd.stateId } })))
          throw new ConflictError("Only unused custom states can be removed");
        return tx.teamState.delete({ where: { id: cmd.stateId } });
      }
      if (current?.kind === "approved" || cmd.name.toLowerCase() === "approved")
        throw new BadRequestError("Approved is the protected final state");
      if (
        await tx.teamState.findFirst({
          where: {
            workspaceId,
            name: { equals: cmd.name, mode: "insensitive" },
            NOT: current ? { id: current.id } : undefined,
          },
        })
      )
        throw new ConflictError("State name already in use");
      return current
        ? tx.teamState.update({
            where: { id: current.id },
            data: { name: cmd.name, position: current.kind === "custom" ? cmd.position : current.position },
          })
        : tx.teamState.create({ data: { workspaceId, name: cmd.name, kind: "custom", position: cmd.position } });
    }
  }
}
