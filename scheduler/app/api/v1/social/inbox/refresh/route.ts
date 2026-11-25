import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { refreshSocialInbox } from "@/lib/social/activity";
import { inboxRefreshSchema } from "@/lib/social/schemas";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = inboxRefreshSchema.parse(
      await req.json().catch(() => {
        throw new BadRequestError("Expected an inbox refresh JSON object.");
      }),
    );
    return NextResponse.json(await refreshSocialInbox(session.user.id, body));
  } catch (error) {
    return handleApiError(error, req);
  }
}
