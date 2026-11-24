// Browser discovery also serves invited collaborators without their own subscription.
import { type NextRequest, NextResponse } from "next/server";

import { getUserFeatures } from "@/lib/features";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    return NextResponse.json(
      { features: await getUserFeatures(session.user.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
