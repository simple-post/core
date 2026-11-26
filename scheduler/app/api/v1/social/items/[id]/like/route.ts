import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { sendSocialLike } from "@/lib/social/activity";
import { inboxItemIdSchema } from "@/lib/social/schemas";
import { handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { userId, workspaceId } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
      true,
    );
    const { id } = await params;
    return NextResponse.json(await sendSocialLike(userId, inboxItemIdSchema.parse(id), workspaceId));
  } catch (error) {
    return handleApiError(error, req);
  }
}
