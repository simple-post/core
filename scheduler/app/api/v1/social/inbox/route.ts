import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getSocialInbox } from "@/lib/social/activity";
import { inboxQuerySchema } from "@/lib/social/schemas";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const query = req.nextUrl.searchParams;
    const needsReply = query.get("needsReply");
    const options = inboxQuerySchema.parse({
      platform: query.get("platform") ?? undefined,
      kind: query.get("kind") ?? undefined,
      accountId: query.get("accountId") ?? undefined,
      cursor: query.get("cursor") ?? undefined,
      needsReply: needsReply === "true" ? true : needsReply === "false" ? false : (needsReply ?? undefined),
      limit: query.has("limit") ? Number(query.get("limit")) : undefined,
    });
    return NextResponse.json(await getSocialInbox(session.user.id, options), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
