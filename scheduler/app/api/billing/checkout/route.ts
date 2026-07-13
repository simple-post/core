import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { getPlanByKey, requireStripePriceId } from "@/lib/billing/plans";
import { getAppUrl, getOrCreateStripeCustomer, getStripe } from "@/lib/billing/stripe";
import { getBillingStatus } from "@/lib/billing/subscriptions";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  planKey: z.enum(["basic", "advanced", "pro"]),
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
    if (env.SELF_HOSTED) {
      throw new NotFoundError("Billing is disabled on this self-hosted instance");
    }

    const session = await requireBrowserSession(req);
    const body = checkoutSchema.parse(await readJsonBody(req));
    const plan = getPlanByKey(body.planKey);
    if (!plan) {
      throw new BadRequestError("Unknown plan");
    }

    const billing = await getBillingStatus(session.user.id);
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    const appUrl = getAppUrl();
    if (billing.accessType === "stripe") {
      return NextResponse.json({ url: `${appUrl}/billing/plans` });
    }

    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(user);

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          price: requireStripePriceId(plan.key),
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      metadata: {
        userId: user.id,
        planKey: plan.key,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          planKey: plan.key,
        },
      },
      success_url: `${appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe?checkout=cancelled&plan=${encodeURIComponent(plan.key)}`,
    });

    if (!checkoutSession.url) {
      throw new BadRequestError("Stripe did not return a Checkout URL");
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    return handleApiError(error);
  }
}
