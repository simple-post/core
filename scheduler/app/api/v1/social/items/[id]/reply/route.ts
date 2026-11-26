import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { sendSocialReply } from "@/lib/social/activity";
import { inboxItemIdSchema, inboxReplySchema } from "@/lib/social/schemas";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { userId, workspaceId } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
      true,
    );
    const { id } = await params;
    const itemId = inboxItemIdSchema.parse(id);
    const body = inboxReplySchema.parse(
      await req.json().catch(() => {
        throw new BadRequestError("Expected a reply JSON object.");
      }),
    );
    return NextResponse.json(await sendSocialReply(userId, { itemId, ...body, workspaceId }));
  } catch (error) {
    return handleApiError(error, req);
  }
}
