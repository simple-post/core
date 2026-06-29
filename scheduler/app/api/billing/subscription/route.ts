import { type NextRequest, NextResponse } from "next/server";

import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getBillingStatus } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const billing = await getBillingStatus(session.user.id);
    const displayCurrency = getBillingDisplayCurrencyFromHeaders(req.headers);

    return NextResponse.json(
      { ...billing, displayCurrency },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
