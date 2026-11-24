import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { handleApiError } from "@/lib/utils/errors";
import { acceptInvite, createWorkspace, listWorkspaces } from "@/lib/workspaces/access";
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
    if (body.action === "accept") {
      const input = z.object({ workspaceId: z.string(), inviteId: z.string() }).parse(body);
      return NextResponse.json(await acceptInvite(user, input.workspaceId, input.inviteId));
    }
    return NextResponse.json(await createWorkspace(user, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
