import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { getXCredits } from "@/lib/utils/x-credits";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const xPostingCredits = await getXCredits(session.user.id);
    return NextResponse.json({ xPostingCredits });
  } catch (error) {
    return handleApiError(error);
  }
}
