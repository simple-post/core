import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { refreshSocialInbox } from "@/lib/social/activity";
import { inboxRefreshSchema } from "@/lib/social/schemas";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { userId, workspaceId } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
      true,
    );
    const body = inboxRefreshSchema.parse(
      await req.json().catch(() => {
        throw new BadRequestError("Expected an inbox refresh JSON object.");
      }),
    );
    return NextResponse.json(await refreshSocialInbox(userId, { ...body, workspaceId }));
  } catch (error) {
    return handleApiError(error, req);
  }
}
