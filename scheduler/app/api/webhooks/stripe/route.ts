import { type NextRequest, NextResponse } from "next/server";

import { getStripe, getStripeWebhookSecret } from "@/lib/billing/stripe";
import { syncCheckoutSession, syncStripeSubscription } from "@/lib/billing/subscriptions";
import { env } from "@/lib/env";
import { createLogger, serializeError } from "@/lib/logger";

import type Stripe from "stripe";

export const dynamic = "force-dynamic";

const log = createLogger("stripe:webhook");

export async function POST(req: NextRequest) {
  if (env.SELF_HOSTED) {
    return NextResponse.json({ error: "Billing is disabled on this self-hosted instance" }, { status: 404 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, getStripeWebhookSecret());
  } catch (error) {
    log.warn({ err: serializeError(error) }, "Invalid Stripe webhook signature");
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.pending_update_applied":
      case "customer.subscription.pending_update_expired":
      case "customer.subscription.resumed":
      case "customer.subscription.updated": {
        await syncStripeSubscription(event.data.object as Stripe.Subscription);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error({ eventId: event.id, eventType: event.type, err: serializeError(error) }, "Stripe webhook failed");
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
