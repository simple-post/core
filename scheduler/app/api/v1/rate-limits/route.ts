import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { getRateLimitStatuses } from "@/lib/utils/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const accountIds = searchParams.getAll("accountId");

    if (accountIds.length === 0) {
      return NextResponse.json({ statuses: [] });
    }

    const statuses = await getRateLimitStatuses(session.user.id, accountIds);
    return NextResponse.json({ statuses });
  } catch (error) {
    return handleApiError(error);
  }
}
