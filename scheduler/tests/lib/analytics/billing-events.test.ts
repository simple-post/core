jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn() }));
import { recordBillingWebhook } from "@/lib/analytics/billing-events";
import { recordFunnelEvent } from "@/lib/analytics/events";

import type Stripe from "stripe";
const event = (type: string, object: Record<string, unknown>, live = true) =>
  ({ type, livemode: live, created: 1_790_000_000, data: { object } }) as unknown as Stripe.Event;
beforeEach(() => jest.clearAllMocks());
it("does not treat zero-paid or test invoices as positive revenue", async () => {
  await recordBillingWebhook(event("invoice.paid", { id: "zero", status: "paid", amount_paid: 0 }), "u");
  await recordBillingWebhook(event("invoice.paid", { amount_paid: 900 }, false), "u");
  expect(recordFunnelEvent).not.toHaveBeenCalled();
});
it("keeps an ended old subscription distinct from the current active account", async () => {
  await recordBillingWebhook(
    event("customer.subscription.deleted", { id: "sub_old", ended_at: 1_790_000_000 }),
    "u",
    "active",
  );
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "u",
    "subscription_ended",
    expect.objectContaining({ properties: { status: "active" } }),
  );
});

it("does not mislabel checkout totals as cash received", async () => {
  await recordBillingWebhook(
    event("checkout.session.expired", {
      id: "cs_expired",
      mode: "subscription",
      payment_status: "unpaid",
      amount_total: 1900,
    }),
    "u",
  );
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "u",
    "checkout_expired",
    expect.objectContaining({ properties: { status: "unpaid", plan: "unknown" } }),
  );
});
