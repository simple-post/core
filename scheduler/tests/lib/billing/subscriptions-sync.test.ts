import { getStripe } from "@/lib/billing/stripe";
import { syncStripeInvoiceSubscription, syncStripeSubscription } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";

jest.mock("@/lib/billing/stripe", () => ({ getStripe: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    userSubscription: { upsert: jest.fn(), findFirst: jest.fn() },
    user: { update: jest.fn(), findFirst: jest.fn() },
  },
}));

const retrieve = jest.fn();
const list = jest.fn();
const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  userSubscription: { upsert: jest.Mock };
};
let subscriptions: Stripe.Subscription[];
let operations: string[];

function subscription(id: string, status: Stripe.Subscription.Status, created: number, extra = {}) {
  return {
    id,
    status,
    created,
    customer: "cus_customer",
    metadata: { userId: "user-1", planKey: "advanced" },
    items: { data: [{ price: { id: "price_advanced", product: "prod_advanced" }, current_period_end: 4_000_000_000 }] },
    cancel_at_period_end: false,
    ...extra,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  jest.clearAllMocks();
  operations = [];
  subscriptions = [subscription("sub_old", "past_due", 100), subscription("sub_paid", "active", 200)];
  jest.mocked(getStripe).mockReturnValue({ subscriptions: { retrieve, list } } as unknown as Stripe);
  retrieve.mockImplementation(async (id) => subscriptions.find((s) => s.id === id));
  list.mockImplementation(() =>
    (async function* () {
      operations.push("stripe_read");
      for (const s of subscriptions) yield s;
    })(),
  );
  mockPrisma.$transaction.mockImplementation(async (callback: unknown) => {
    return (callback as (client: typeof prisma) => Promise<unknown>)(prisma);
  });
  mockPrisma.$queryRaw.mockImplementation(async () => {
    operations.push("lock");
    return [];
  });
  mockPrisma.userSubscription.upsert.mockImplementation(async (args) => {
    operations.push("persist");
    return { userId: "user-1", ...args.update } as never;
  });
});

it("keeps paid access when an older invoice retry fails, even if the local record is wrong", async () => {
  const invoice = {
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_old", metadata: {} } },
  } as Stripe.Invoice;
  const result = await syncStripeInvoiceSubscription(invoice);
  expect(result).toMatchObject({ stripeSubscriptionId: "sub_paid", status: "active", planKey: "advanced" });
  expect(operations).toEqual(["lock", "stripe_read", "persist"]);
  expect(list).toHaveBeenCalledWith({ customer: "cus_customer", status: "all", limit: 100 });
});

it("ignores stale webhook payloads and uses current Stripe state", async () => {
  const result = await syncStripeSubscription({ ...subscriptions[1], status: "canceled" });
  expect(retrieve).toHaveBeenCalledWith("sub_paid", { expand: ["items.data.price.product"] });
  expect(result).toMatchObject({ stripeSubscriptionId: "sub_paid", status: "active" });
});

it("removes paid access when the last active subscription is canceled", async () => {
  subscriptions[1].status = "canceled";
  expect(await syncStripeSubscription(subscriptions[0])).toMatchObject({
    stripeSubscriptionId: "sub_paid",
    status: "canceled",
  });
});

it("falls back to another active subscription when the selected subscription is canceled", async () => {
  subscriptions[0].status = "active";
  subscriptions[1].status = "canceled";
  expect(await syncStripeSubscription(subscriptions[1])).toMatchObject({
    stripeSubscriptionId: "sub_old",
    status: "active",
  });
});

it("chooses deterministically among multiple active subscriptions regardless of listing order", async () => {
  subscriptions[0].status = "active";
  expect(await syncStripeSubscription(subscriptions[0])).toMatchObject({ stripeSubscriptionId: "sub_paid" });
  subscriptions.reverse();
  expect(await syncStripeSubscription(subscriptions[1])).toMatchObject({ stripeSubscriptionId: "sub_paid" });
});

it("prefers a paid subscription to a newer trial or incomplete checkout", async () => {
  subscriptions.push(subscription("sub_trial", "trialing", 300), subscription("sub_incomplete", "incomplete", 400));
  expect(await syncStripeSubscription(subscriptions[0])).toMatchObject({ stripeSubscriptionId: "sub_paid" });
});

it("does not select an expired period, unsupported plan, or another user's subscription over paid access", async () => {
  subscriptions.push(
    subscription("sub_expired", "active", 300, {
      items: { data: [{ price: { id: "price_advanced" }, current_period_end: 1 }] },
    }),
    subscription("sub_other_product", "active", 400, { metadata: { userId: "user-1" } }),
    subscription("sub_other_user", "active", 500, { metadata: { userId: "user-2", planKey: "pro" } }),
  );
  expect(await syncStripeSubscription(subscriptions[0])).toMatchObject({ stripeSubscriptionId: "sub_paid" });
});

it("retains a valid Stripe trial when no paid subscription exists", async () => {
  subscriptions[1].status = "trialing";
  expect(await syncStripeSubscription(subscriptions[0])).toMatchObject({
    stripeSubscriptionId: "sub_paid",
    status: "trialing",
  });
});

it("does not write partial state if Stripe enumeration fails", async () => {
  list.mockImplementation(() =>
    (async function* () {
      yield subscriptions[0];
      throw new Error("Stripe unavailable");
    })(),
  );
  await expect(syncStripeSubscription(subscriptions[0])).rejects.toThrow("Stripe unavailable");
  expect(prisma.userSubscription.upsert).not.toHaveBeenCalled();
  expect(prisma.user.update).not.toHaveBeenCalled();
});
