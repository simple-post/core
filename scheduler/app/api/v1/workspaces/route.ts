import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";
import { acceptInvite, createWorkspace, listWorkspaces } from "@/lib/workspaces/access";
import { personalWorkspaceFields } from "@/lib/workspaces/contracts";
import { normalizeWorkspaceLogo } from "@/lib/workspaces/logo";
import { requireTeamWorkspaceSession } from "@/lib/workspaces/session";
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireTeamWorkspaceSession(req);
    return NextResponse.json(await listWorkspaces(user));
  } catch (error) {
    return handleApiError(error, req);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireTeamWorkspaceSession(req);
    const body = await req.json();
    if (body.action === "personalSettings") {
      const values = personalWorkspaceFields.parse(body);
      const personal = await prisma.user.update({
        where: { id: user.id },
        data: {
          personalWorkspaceName: values.name,
          personalWorkspaceColor: values.color,
          personalWorkspaceLogo: await normalizeWorkspaceLogo(values.logo),
        },
        select: { personalWorkspaceLogo: true },
      });
      return NextResponse.json({
        personal: { name: values.name, color: values.color, logo: personal.personalWorkspaceLogo },
      });
    }
    if (body.action === "accept") {
      const input = z.object({ workspaceId: z.string(), inviteId: z.string() }).parse(body);
      return NextResponse.json(await acceptInvite(user, input.workspaceId, input.inviteId));
    }
    return NextResponse.json(await createWorkspace(user, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
