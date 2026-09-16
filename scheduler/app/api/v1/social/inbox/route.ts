import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getSocialInbox } from "@/lib/social/activity";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const kind = req.nextUrl.searchParams.get("kind");
    const platform = req.nextUrl.searchParams.get("platform");
    const cursor = req.nextUrl.searchParams.get("cursor");
    const accountId = req.nextUrl.searchParams.get("accountId");
    if (kind !== null && kind !== "comment" && kind !== "mention") throw new BadRequestError("Invalid inbox kind");
    const limitText = req.nextUrl.searchParams.get("limit");
    const limit = limitText ? Number(limitText) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
      throw new BadRequestError("Invalid inbox limit");
    return NextResponse.json(
      await getSocialInbox(session.user.id, {
        kind: kind as "comment" | "mention" | undefined,
        platform: platform || undefined,
        accountId: accountId || undefined,
        cursor: cursor || undefined,
        limit,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
