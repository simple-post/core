import { getPlanByKey } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";

function objectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id || null;
}

export function subscriptionPayment(invoice: Stripe.Invoice) {
  const details = invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
  const subscriptionId = objectId(details?.subscription);
  const customerId = objectId(invoice.customer);
  const paidAt = invoice.status_transitions?.paid_at;
  if (
    !invoice.livemode ||
    invoice.status !== "paid" ||
    invoice.amount_paid <= 0 ||
    !paidAt ||
    !subscriptionId ||
    !customerId
  )
    return null;
  return {
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    paidAt: new Date(paidAt * 1000),
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    planKey: getPlanByKey(details?.metadata?.planKey)?.key || null,
    customerId,
  };
}

/** Called only after signature verification and canonical subscription synchronization. */
export async function recordFirstPayment(
  invoice: Stripe.Invoice,
  subscription: { userId: string; stripeSubscriptionId: string | null; stripeCustomerId: string } | null,
) {
  const payment = subscriptionPayment(invoice);
  if (
    !payment ||
    !subscription ||
    payment.stripeSubscriptionId !== subscription.stripeSubscriptionId ||
    payment.customerId !== subscription.stripeCustomerId
  )
    return;
  const user = await prisma.user.findUnique({ where: { id: subscription.userId }, select: { acquisition: true } });
  // Legacy accounts have unknown payment history. A renewal must not be labelled their first payment.
  if (!user?.acquisition) return;
  // Native UPSERT is atomic even when two different webhook events race to insert.
  // An older invoice delivered later can only move the first-payment date earlier.
  await prisma.$executeRaw`
    INSERT INTO "first_payment" ("userId", "stripeInvoiceId", "stripeSubscriptionId", "paidAt", "amountPaid", "currency", "planKey", "createdAt")
    VALUES (${subscription.userId}, ${payment.stripeInvoiceId}, ${payment.stripeSubscriptionId}, ${payment.paidAt.toISOString()}::timestamp, ${payment.amountPaid}, ${payment.currency}, ${payment.planKey}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT ("userId") DO UPDATE SET
      "stripeInvoiceId" = EXCLUDED."stripeInvoiceId",
      "stripeSubscriptionId" = EXCLUDED."stripeSubscriptionId",
      "paidAt" = EXCLUDED."paidAt",
      "amountPaid" = EXCLUDED."amountPaid",
      "currency" = EXCLUDED."currency",
      "planKey" = EXCLUDED."planKey"
    WHERE EXCLUDED."paidAt" < "first_payment"."paidAt"
  `;
}
