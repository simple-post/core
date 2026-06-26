import { type NextRequest, NextResponse } from "next/server";

import { getBillingStatus } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const billing = await getBillingStatus(session.user.id);

    return NextResponse.json(billing, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
