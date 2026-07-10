import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { getStripe, getStripeWebhookSecret } from "@/lib/billing/stripe";
import {
  syncCheckoutSession,
  syncStripeInvoiceSubscription,
  syncStripeSubscription,
} from "@/lib/billing/subscriptions";
import { env } from "@/lib/env";
import { createLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";

export const dynamic = "force-dynamic";

const log = createLogger("stripe:webhook");

const STALE_PROCESSING_AFTER_MS = 10 * 60 * 1000;

type StripeEventClaim = "claimed" | "succeeded" | "in_progress";

/**
 * Atomically claims a Stripe event for processing. Stripe may deliver an event
 * more than once, and two deliveries can race before either has finished.
 * Recent processing is returned as a retryable response; stale/failed records
 * can be reclaimed after a crash or a handler failure.
 */
async function claimStripeEvent(event: Stripe.Event): Promise<StripeEventClaim> {
  try {
    await prisma.stripeEvent.create({
      data: {
        id: event.id,
        type: event.type,
        status: "processing",
        attempts: 1,
      },
    });
    return "claimed";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (!existing) {
    // A concurrent delete or transient read race should be retried by Stripe.
    return "in_progress";
  }

  if (existing.status === "succeeded") {
    return "succeeded";
  }

  const staleBefore = new Date(Date.now() - STALE_PROCESSING_AFTER_MS);
  const canReclaim =
    existing.status === "failed" || (existing.status === "processing" && existing.updatedAt < staleBefore);
  if (!canReclaim) {
    return "in_progress";
  }

  const reclaimed = await prisma.stripeEvent.updateMany({
    where: {
      id: event.id,
      OR: [{ status: "failed" }, { status: "processing", updatedAt: { lt: staleBefore } }],
    },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      lastError: null,
      processedAt: null,
    },
  });

  return reclaimed.count === 1 ? "claimed" : "in_progress";
}

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
    const claim = await claimStripeEvent(event);
    if (claim === "succeeded") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim === "in_progress") {
      return NextResponse.json({ error: "Webhook event is already being processed" }, { status: 409 });
    }

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
      case "invoice.paid":
      case "invoice.payment_action_required":
      case "invoice.payment_attempt_required":
      case "invoice.payment_failed":
      case "invoice.payment_succeeded": {
        await syncStripeInvoiceSubscription(event.data.object as Stripe.Invoice);
        break;
      }
    }

    await prisma.stripeEvent.update({
      where: { id: event.id },
      data: { status: "succeeded", processedAt: new Date(), lastError: null },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error({ eventId: event.id, eventType: event.type, err: serializeError(error) }, "Stripe webhook failed");
    await prisma.stripeEvent
      .update({
        where: { id: event.id },
        data: {
          status: "failed",
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        },
      })
      .catch(() => {});
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
