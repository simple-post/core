import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { recordFirstPayment } from "@/lib/analytics/first-payment";
import { createFirstTouch } from "@/lib/analytics/first-touch";
import { buildAcquisitionReport } from "@/lib/analytics/report";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";
const userId = "attribution-review-user";
const subscription = { userId, stripeSubscriptionId: "sub_attribution", stripeCustomerId: "cus_attribution" };
function invoice(id: string, date = "2026-09-15", extra: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id,
    livemode: true,
    status: "paid",
    amount_paid: 1900,
    currency: "usd",
    customer: "cus_attribution",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_attribution", metadata: { planKey: "basic" } },
    },
    status_transitions: { paid_at: new Date(date).getTime() / 1000 },
    ...extra,
  } as unknown as Stripe.Invoice;
}
beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Attribution Test",
      email: "attribution-review@example.com",
      emailVerified: true,
      createdAt: new Date("2026-09-01"),
      acquisition: JSON.stringify(
        createFirstTouch(
          "https://simplepost.social/?utm_source=chatgpt&utm_campaign=launch",
          "",
          new Date("2026-09-01"),
        ),
      ),
      freeTrial: { create: { startsAt: new Date("2026-09-01"), expiresAt: new Date("2026-09-08") } },
    },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
it("deduplicates concurrent deliveries and preserves earliest payment across renewals", async () => {
  await Promise.all(
    Array.from({ length: 12 }, () => recordFirstPayment(invoice("in_late", "2026-09-20"), subscription)),
  );
  await Promise.all([
    recordFirstPayment(invoice("in_first"), subscription),
    recordFirstPayment(invoice("in_renewal", "2026-09-22"), subscription),
    recordFirstPayment(invoice("in_first"), subscription),
  ]);
  expect(await prisma.firstPayment.count({ where: { userId } })).toBe(1);
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { firstPayment: true, freeTrial: true, subscription: true },
  });
  expect(account.firstPayment).toMatchObject({ stripeInvoiceId: "in_first", paidAt: new Date("2026-09-15") });
  expect(buildAcquisitionReport([account], new Date("2026-09-22"))[0]).toMatchObject({
    source: "chatgpt",
    campaign: "launch",
    paid: 1,
    matureConversionRate: 1,
  });
});
it("ignores test, unpaid, zero-value, mismatched and non-subscription invoices", async () => {
  for (const extra of [
    { livemode: false },
    { amount_paid: 0 },
    { status: "open" },
    { customer: "cus_other" },
    { parent: null },
  ] as Partial<Stripe.Invoice>[])
    await recordFirstPayment(invoice("in_ignored", undefined, extra), subscription);
  expect(await prisma.firstPayment.count({ where: { userId } })).toBe(0);
});
it("does not relabel legacy renewals as first payments", async () => {
  await prisma.$executeRaw`UPDATE "user" SET "acquisition" = NULL WHERE "id" = ${userId}`;
  await recordFirstPayment(invoice("in_legacy"), subscription);
  expect(await prisma.firstPayment.count({ where: { userId } })).toBe(0);
});
it("removes attribution ledger when account is deleted", async () => {
  await recordFirstPayment(invoice("in_delete"), subscription);
  await prisma.user.delete({ where: { id: userId } });
  expect(await prisma.firstPayment.count({ where: { userId } })).toBe(0);
});

it("defaults to non-admin and honors database grants and revocations immediately", async () => {
  expect(await hasAnalyticsAdminAccess(userId)).toBe(false);
  await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
  expect(await hasAnalyticsAdminAccess(userId)).toBe(true);
  await prisma.user.update({ where: { id: userId }, data: { isAdmin: false } });
  expect(await hasAnalyticsAdminAccess(userId)).toBe(false);
  await prisma.user.update({ where: { id: userId }, data: { isAdmin: true, emailVerified: false } });
  expect(await hasAnalyticsAdminAccess(userId)).toBe(false);
  expect(await hasAnalyticsAdminAccess("missing-admin-user")).toBe(false);
});
