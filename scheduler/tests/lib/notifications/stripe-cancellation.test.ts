import { getStripeCancellation } from "@/lib/notifications/stripe-cancellation";

import type Stripe from "stripe";

function subscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  object: Record<string, unknown>,
  previousAttributes?: Record<string, unknown>,
) {
  return {
    type,
    created: 1_800_000_000,
    data: {
      object: { id: "sub_1", canceled_at: 1_800_000_000, ...object },
      previous_attributes: previousAttributes,
    },
  } as Stripe.Event;
}

it("confirms a period-end cancellation when requested, not when the plan ends", () => {
  const periodEnd = 1_801_000_000;
  const subscription = {
    cancel_at_period_end: true,
    cancel_at: periodEnd,
    cancellation_details: { reason: "cancellation_requested" },
  };
  const requested = subscriptionEvent("customer.subscription.updated", subscription, { cancel_at_period_end: false });
  expect(getStripeCancellation(requested)).toEqual({
    kind: "paid_cancellation",
    key: "billing-cancellation/sub_1/1800000000",
    occurredAt: new Date(1_800_000_000_000),
    effectiveAt: new Date(1_801_000_000_000),
  });
  const ended = subscriptionEvent("customer.subscription.deleted", { ...subscription, ended_at: periodEnd });
  expect(getStripeCancellation(ended)).toBeNull();
});

it("ignores unrelated updates to a cancelling subscription", () => {
  const event = subscriptionEvent(
    "customer.subscription.updated",
    { cancel_at_period_end: true, cancel_at: 1_801_000_000 },
    { metadata: {} },
  );
  expect(getStripeCancellation(event)).toBeNull();
});

it("distinguishes immediate requested cancellation from failed payment", () => {
  const ended = { cancel_at_period_end: false, ended_at: 1_800_000_000 };
  const requested = subscriptionEvent("customer.subscription.deleted", {
    ...ended,
    cancellation_details: { reason: "cancellation_requested" },
  });
  const paymentFailed = subscriptionEvent("customer.subscription.deleted", {
    ...ended,
    cancellation_details: { reason: "payment_failed" },
  });
  expect(getStripeCancellation(requested)?.effectiveAt).toEqual(new Date(1_800_000_000_000));
  expect(getStripeCancellation(paymentFailed)).toBeNull();
});
