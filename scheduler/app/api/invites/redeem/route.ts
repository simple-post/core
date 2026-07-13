import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { getBillingStatus } from "@/lib/billing/subscriptions";
import { redeemComplimentaryInvite } from "@/lib/invites/complimentary-access";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const redeemSchema = z.object({
  code: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const body = redeemSchema.parse(await req.json().catch(() => ({})));
    const redemption = await redeemComplimentaryInvite(session.user.id, body.code);
    const billing = await getBillingStatus(session.user.id);

    return NextResponse.json(
      { redemption, billing },
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
