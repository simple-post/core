import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getSocialInbox } from "@/lib/social/activity";
import { inboxQuerySchema } from "@/lib/social/schemas";
import { handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { userId, workspaceId } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
    );
    const query = req.nextUrl.searchParams;
    const needsReply = query.get("needsReply");
    const options = inboxQuerySchema.parse({
      platforms: query.has("platform") ? query.getAll("platform") : undefined,
      kind: query.get("kind") ?? undefined,
      accountId: query.get("accountId") ?? undefined,
      cursor: query.get("cursor") ?? undefined,
      needsReply: needsReply === "true" ? true : needsReply === "false" ? false : (needsReply ?? undefined),
      limit: query.has("limit") ? Number(query.get("limit")) : undefined,
    });
    return NextResponse.json(await getSocialInbox(userId, { ...options, workspaceId }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
