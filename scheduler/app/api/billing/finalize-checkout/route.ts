import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getStripe } from "@/lib/billing/stripe";
import { getBillingStatus, syncCheckoutSession } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { BadRequestError, ForbiddenError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const finalizeCheckoutSchema = z.object({
  sessionId: z.string().min(1),
});

async function readJsonBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const browserSession = await requireBrowserSession(req);
    const parsed = finalizeCheckoutSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      throw new BadRequestError("Missing Checkout Session");
    }

    const checkoutSession = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);
    const checkoutUserId = checkoutSession.metadata?.userId || checkoutSession.client_reference_id;
    if (checkoutUserId !== browserSession.user.id) {
      throw new ForbiddenError("Checkout Session does not belong to this account");
    }
    if (checkoutSession.mode !== "subscription") {
      throw new BadRequestError("Checkout Session is not a subscription");
    }

    await syncCheckoutSession(checkoutSession);

    const billing = await getBillingStatus(browserSession.user.id);
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
