import { type NextRequest, NextResponse } from "next/server";

import { getAppUrl, getStripe } from "@/lib/billing/stripe";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        stripeCustomerId: true,
        subscription: {
          select: {
            stripeCustomerId: true,
          },
        },
      },
    });

    const customerId = user?.stripeCustomerId ?? user?.subscription?.stripeCustomerId;
    if (!customerId) {
      throw new BadRequestError("No Stripe customer found for this account");
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppUrl()}/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    return handleApiError(error);
  }
}
