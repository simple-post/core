import { hasFeature } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/utils/errors";

import { workspaceFields, type Actor } from "./contracts";

import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export async function lockWorkspace(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "TeamWorkspace" WHERE id = ${id} FOR UPDATE`;
}
export async function membership(tx: Tx, workspaceId: string, userId: string) {
  const member = await tx.teamMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) throw new NotFoundError("Workspace not found");
  return member;
}
export function authorize(member: { role: string; approver: boolean }, permission: "edit" | "admin" | "approve") {
  const allowed =
    permission === "approve"
      ? member.approver
      : permission === "admin"
        ? member.role === "Admin"
        : ["Admin", "Editor"].includes(member.role);
  if (!allowed) throw new ForbiddenError("Your workspace permissions do not allow this action");
}
export async function listWorkspaces(actor: Actor) {
  const [memberships, invites, personal] = await Promise.all([
    prisma.teamMember.findMany({
      where: { userId: actor.id },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, icon: true, color: true, logo: true, creatorId: true } },
      },
      orderBy: { workspace: { name: "asc" } },
    }),
    actor.emailVerified
      ? prisma.teamInvite.findMany({
          where: { email: actor.email.toLowerCase(), expiresAt: { gt: new Date() } },
          include: { workspace: { select: { name: true } } },
        })
      : [],
    prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { personalWorkspaceName: true, personalWorkspaceColor: true, personalWorkspaceLogo: true },
    }),
  ]);
  return {
    personal: {
      name: personal.personalWorkspaceName,
      color: personal.personalWorkspaceColor,
      logo: personal.personalWorkspaceLogo,
    },
    workspaces: memberships.map(({ workspace: { creatorId, ...workspace }, role }) => ({
      ...workspace,
      role,
      canManage: creatorId === actor.id && role === "Admin",
    })),
    invites,
  };
}
export async function createWorkspace(actor: Actor, input: unknown) {
  if (!(await hasFeature(actor.id, "TEAM_WORKSPACES"))) throw new NotFoundError();
  const fields = workspaceFields.parse(input);
  return prisma.teamWorkspace.create({
    data: {
      ...fields,
      creatorId: actor.id,
      members: { create: { userId: actor.id, role: "Admin", approver: true } },
      states: {
        create: [
          { kind: "draft", name: "Draft", position: 0 },
          { kind: "progress", name: "In progress", position: 10 },
          { kind: "review", name: "In review", position: 1000 },
          { kind: "approved", name: "Approved", position: 1001 },
        ],
      },
    },
    select: { id: true },
  });
}
export async function acceptInvite(actor: Actor, workspaceId: string, inviteId: string) {
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const invite = await tx.teamInvite.findFirst({
      where: { id: inviteId, workspaceId, email: actor.email.toLowerCase(), expiresAt: { gt: new Date() } },
    });
    if (!actor.emailVerified || !invite) throw new NotFoundError("Invitation expired or unavailable for this email");
    if (await tx.teamMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: actor.id } } }))
      throw new ConflictError("Already a member");
    await tx.teamMember.create({
      data: { workspaceId, userId: actor.id, role: invite.role, approver: invite.approver },
    });
    await tx.teamInvite.delete({ where: { id: invite.id } });
    return { id: workspaceId };
  });
}
export async function readWorkspace(actor: Actor, id: string) {
  return prisma.$transaction(
    async (tx) => {
      const member = await membership(tx, id, actor.id);
      const workspace = await tx.teamWorkspace.findUniqueOrThrow({
        where: { id },
        include: {
          members: { include: { user: { select: { name: true, email: true } } }, orderBy: { user: { name: "asc" } } },
          states: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          posts: {
            orderBy: { plannedAt: "asc" },
            include: {
              reviews: {
                orderBy: { requestedAt: "desc" },
                include: { deliveries: { select: { id: true, status: true } } },
              },
              events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            },
          },
          files: { select: { id: true, filename: true, mime: true } },
          invites:
            member.role === "Admin" ? { where: { expiresAt: { gt: new Date() } }, orderBy: { email: "asc" } } : false,
        },
      });
      const accounts =
        actor.id === workspace.creatorId
          ? await tx.connectedAccount.findMany({
              where: { userId: actor.id, workspaceId: id, platform: { in: ["instagram", "tiktok", "linkedin"] } },
              select: { id: true, platform: true, username: true, displayName: true },
            })
          : [];
      return { ...workspace, invites: workspace.invites ?? [], member, accounts };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
