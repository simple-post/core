import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { acceptInvite, createWorkspace, listWorkspaces } from "@/lib/workspaces/access";
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireBrowserSession(req);
    return NextResponse.json(await listWorkspaces(user));
  } catch (error) {
    return handleApiError(error, req);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireBrowserSession(req);
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
