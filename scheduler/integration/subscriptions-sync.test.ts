import { getStripe } from "@/lib/billing/stripe";
import { assertActiveSubscription, getBillingStatus, syncStripeSubscriptionById } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";

jest.mock("@/lib/billing/stripe", () => ({ getStripe: jest.fn() }));

const userId = "subscription-sync-review-user";
const customer = "cus_sync_review";
const retrieve = jest.fn();
const list = jest.fn();
let canonical: Stripe.Subscription[];
let enumerations = 0;
let maxEnumerations = 0;

function subscription(id: string, status: Stripe.Subscription.Status, created: number) {
  return {
    id,
    status,
    created,
    customer,
    metadata: { userId, planKey: "advanced" },
    items: {
      data: [
        {
          price: { id: "price_sync_review", product: "prod_sync_review" },
          current_period_start: 1_700_000_000,
          current_period_end: 4_000_000_000,
        },
      ],
    },
    cancel_at_period_end: false,
  } as unknown as Stripe.Subscription;
}

beforeEach(async () => {
  jest.clearAllMocks();
  delete process.env.SELF_HOSTED;
  enumerations = 0;
  maxEnumerations = 0;
  canonical = [subscription("sub_sync_old", "past_due", 100), subscription("sub_sync_paid", "active", 200)];
  jest.mocked(getStripe).mockReturnValue({ subscriptions: { retrieve, list } } as unknown as Stripe);
  retrieve.mockImplementation(async (id) => canonical.find((s) => s.id === id));
  list.mockImplementation(() =>
    (async function* () {
      enumerations++;
      maxEnumerations = Math.max(maxEnumerations, enumerations);
      try {
        // Hold the enumeration open so concurrent handlers would overlap without
        // the database row lock. No live Stripe calls or publishing are involved.
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const s of canonical) yield s;
      } finally {
        enumerations--;
      }
    })(),
  );
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Subscription sync test",
      email: "subscription-sync-review@example.com",
      stripeCustomerId: customer,
      freeTrial: { create: { startsAt: new Date("2020-01-01"), expiresAt: new Date("2020-01-08") } },
      subscription: {
        create: {
          stripeCustomerId: customer,
          stripeSubscriptionId: "sub_sync_old",
          status: "past_due",
          planKey: "advanced",
        },
      },
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it("repairs the wrong local subscription and keeps paid access across racing old and new events", async () => {
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => syncStripeSubscriptionById(i % 2 ? "sub_sync_old" : "sub_sync_paid")),
  );
  expect(maxEnumerations).toBe(1);
  expect(await prisma.userSubscription.count({ where: { userId } })).toBe(1);
  expect(await getBillingStatus(userId)).toMatchObject({
    active: true,
    accessType: "stripe",
    plan: { key: "advanced" },
    subscription: { stripeSubscriptionId: "sub_sync_paid" },
  });
  await expect(assertActiveSubscription(userId)).resolves.toMatchObject({ active: true });
});

it("revokes access after cancellation even when an older failed-invoice event arrives last", async () => {
  await syncStripeSubscriptionById("sub_sync_paid");
  canonical[1].status = "canceled";
  await syncStripeSubscriptionById("sub_sync_paid");
  await syncStripeSubscriptionById("sub_sync_old");
  expect(await getBillingStatus(userId)).toMatchObject({
    active: false,
    subscription: { stripeSubscriptionId: "sub_sync_paid", status: "canceled" },
  });
  await expect(assertActiveSubscription(userId)).rejects.toMatchObject({
    statusCode: 402,
    message: expect.stringContaining("subscription is not active"),
  });
});

it("reports a payment issue instead of trial expiry for a delinquent subscriber", async () => {
  canonical = [canonical[0]];
  await syncStripeSubscriptionById("sub_sync_old");
  await expect(assertActiveSubscription(userId)).rejects.toMatchObject({
    statusCode: 402,
    message: expect.stringContaining("subscription payment needs attention"),
  });
});
