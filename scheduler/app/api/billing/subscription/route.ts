import { type NextRequest, NextResponse } from "next/server";

import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getBillingStatus } from "@/lib/billing/subscriptions";
import { ensureTrialStarted } from "@/lib/billing/trial";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    // Deliberate write on a GET: every protected page load passes through here
    // via SubscriptionGate, which makes it the one place that reliably grants a
    // user their trial on first sign-in — existing accounts included. The call
    // is idempotent and this route is already force-dynamic + no-store.
    await ensureTrialStarted(session.user.id);
    const billing = await getBillingStatus(session.user.id);
    const displayCurrency = getBillingDisplayCurrencyFromHeaders(req.headers);
    const subscription = billing.subscription;
    const cancellation =
      subscription?.canceledAt && subscription.stripeSubscriptionId
        ? await prisma.billingNotification.findUnique({
            where: {
              key: `billing-cancellation/${subscription.stripeSubscriptionId}/${Date.parse(subscription.canceledAt) / 1000}`,
              userId: session.user.id,
            },
            select: { key: true },
          })
        : null;

    return NextResponse.json(
      {
        ...billing,
        displayCurrency,
        selfHosted: env.SELF_HOSTED,
        cancellationFeedbackAvailable: Boolean(cancellation),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
