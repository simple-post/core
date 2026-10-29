import { recordFunnelEvent } from "./events";

import type Stripe from "stripe";

/** Signed webhook facts only. Renewals, failed attempts and zero-value invoices stay distinct. */
export async function recordBillingWebhook(event: Stripe.Event, userId: string | undefined, canonicalStatus?: string) {
  if (!event.livemode || !userId) return;
  const at = new Date(event.created * 1000);
  if (event.type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice;
    if (
      (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") &&
      invoice.status === "paid" &&
      invoice.amount_paid > 0
    ) {
      await recordFunnelEvent(userId, "invoice_paid", {
        key: invoice.id,
        channel: "billing",
        at: new Date((invoice.status_transitions.paid_at ?? event.created) * 1000),
        properties: {
          amountPaid: invoice.amount_paid,
          currency: invoice.currency,
          billingReason: invoice.billing_reason ?? "unknown",
        },
      });
    } else if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
      await recordFunnelEvent(userId, "invoice_payment_failed", {
        key: `${invoice.id}:${invoice.attempt_count}:${event.type}`,
        channel: "billing",
        at,
        properties: {
          reason: event.type === "invoice.payment_action_required" ? "action_required" : "payment_failed",
          attempt: invoice.attempt_count,
          currency: invoice.currency,
        },
      });
    }
  } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
    const checkout = event.data.object as Stripe.Checkout.Session;
    if (checkout.mode !== "subscription") return;
    await recordFunnelEvent(
      userId,
      event.type === "checkout.session.completed" ? "checkout_completed" : "checkout_expired",
      {
        key: checkout.id,
        channel: "billing",
        at,
        properties: {
          status: checkout.payment_status,
          plan: checkout.metadata?.planKey ?? "unknown",
          amountPaid: checkout.amount_total ?? 0,
        },
      },
    );
  } else if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    if (event.type === "customer.subscription.deleted") {
      await recordFunnelEvent(userId, "subscription_ended", {
        key: subscription.id,
        channel: "billing",
        at: new Date((subscription.ended_at ?? event.created) * 1000),
        properties: { status: canonicalStatus ?? "unknown" },
      });
    } else if (subscription.cancel_at_period_end) {
      await recordFunnelEvent(userId, "subscription_cancel_requested", {
        key: `${subscription.id}:${subscription.canceled_at ?? event.created}`,
        channel: "billing",
        at,
        properties: { status: canonicalStatus ?? "unknown" },
      });
    }
  }
}
