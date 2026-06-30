import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getPlanByKey, requireStripePriceId } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { getBillingStatus, syncStripeSubscription } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { BadRequestError, PaymentRequiredError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const changePlanSchema = z.object({
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
    const session = await requireBrowserSession(req);
    const parsed = changePlanSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      throw new BadRequestError("Choose a valid plan");
    }

    const plan = getPlanByKey(parsed.data.planKey);
    if (!plan) {
      throw new BadRequestError("Unknown plan");
    }

    const billing = await getBillingStatus(session.user.id);
    const subscriptionId = billing.subscription?.stripeSubscriptionId;
    if (!billing.active || !subscriptionId) {
      throw new PaymentRequiredError("An active subscription is required to change plans");
    }

    const displayCurrency = getBillingDisplayCurrencyFromHeaders(req.headers);
    const targetPriceId = requireStripePriceId(plan.key);

    if (billing.subscription?.stripePriceId === targetPriceId && billing.plan?.key === plan.key) {
      return NextResponse.json(
        { ...billing, displayCurrency },
        {
          headers: {
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    const stripe = getStripe();
    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    });
    const subscriptionItem = stripeSubscription.items.data[0];
    if (!subscriptionItem) {
      throw new BadRequestError("Subscription has no billable item");
    }

    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      expand: ["items.data.price.product"],
      items: [
        {
          id: subscriptionItem.id,
          price: targetPriceId,
        },
      ],
      metadata: {
        ...stripeSubscription.metadata,
        userId: session.user.id,
        planKey: plan.key,
      },
      payment_behavior: "error_if_incomplete",
      proration_behavior: "create_prorations",
    });

    await syncStripeSubscription(updatedSubscription, session.user.id);

    const updatedBilling = await getBillingStatus(session.user.id);
    return NextResponse.json(
      { ...updatedBilling, displayCurrency },
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
