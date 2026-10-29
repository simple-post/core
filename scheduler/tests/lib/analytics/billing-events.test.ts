jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn() }));
import { recordBillingWebhook } from "@/lib/analytics/billing-events";
import { recordFunnelEvent } from "@/lib/analytics/events";

import type Stripe from "stripe";
const event = (type: string, object: Record<string, unknown>, live = true) =>
  ({ type, livemode: live, created: 1_790_000_000, data: { object } }) as unknown as Stripe.Event;
beforeEach(() => jest.clearAllMocks());
it("deduplicates positive invoice facts across the two success notification types", async () => {
  const invoice = {
    id: "in_one",
    status: "paid",
    amount_paid: 900,
    currency: "usd",
    billing_reason: "subscription_cycle",
    status_transitions: { paid_at: 1_790_000_000 },
  };
  await recordBillingWebhook(event("invoice.paid", invoice), "u");
  await recordBillingWebhook(event("invoice.payment_succeeded", invoice), "u");
  expect((recordFunnelEvent as jest.Mock).mock.calls.map((x) => [x[1], x[2].key])).toEqual([
    ["invoice_paid", "in_one"],
    ["invoice_paid", "in_one"],
  ]);
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "u",
    "invoice_paid",
    expect.objectContaining({ properties: expect.objectContaining({ billingReason: "subscription_cycle" }) }),
  );
});
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
