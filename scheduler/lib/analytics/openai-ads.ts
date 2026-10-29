import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

import { subscriptionPayment } from "./first-payment";

import type Stripe from "stripe";

const CONSENT_VERSION = "purchase-v1";
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Opt-in deployment: never send development, preview or self-hosted traffic. */
export function openAiAdsConfigured(): boolean {
  return (
    process.env.OPENAI_ADS_MEASUREMENT_ENABLED === "true" &&
    process.env.NODE_ENV === "production" &&
    env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "") === "https://app.simplepost.social" &&
    !env.SELF_HOSTED &&
    Boolean(process.env.OPENAI_ADS_PIXEL_ID && process.env.OPENAI_CONVERSIONS_API_KEY)
  );
}

export function openAiSubscriptionEvent(invoice: Stripe.Invoice, now = Date.now()) {
  const payment = subscriptionPayment(invoice);
  const metadata = invoice.parent?.subscription_details?.metadata;
  const consentAt = Number(metadata?.openaiAdsConsentAt);
  const email = invoice.customer_email?.trim().toLowerCase();
  if (
    !payment ||
    !payment.planKey ||
    !email ||
    metadata?.openaiAdsConsent !== CONSENT_VERSION ||
    !Number.isSafeInteger(consentAt) ||
    consentAt <= 0 ||
    consentAt > payment.paidAt.getTime() ||
    now - payment.paidAt.getTime() >= MAX_EVENT_AGE_MS ||
    payment.paidAt.getTime() > now
  )
    return null;

  return {
    // Both invoice.paid and invoice.payment_succeeded, and all retries, share this ID.
    id: `simplepost_subscription_${invoice.id}`,
    type: "subscription_created",
    timestamp_ms: payment.paidAt.getTime(),
    action_source: "web",
    source_url: "https://app.simplepost.social/billing",
    opt_out: true,
    user: { emails_sha256: [createHash("sha256").update(email, "utf8").digest("hex")] },
    data: {
      type: "plan_enrollment",
      plan_id: payment.planKey,
      amount: payment.amountPaid,
      currency: payment.currency.toUpperCase(),
    },
  };
}

/** Called after signature verification, billing sync and recording the first payment. */
export async function reportOpenAiSubscription(
  invoice: Stripe.Invoice,
  subscription: { userId: string; stripeSubscriptionId: string | null; stripeCustomerId: string } | null,
) {
  if (!openAiAdsConfigured() || !subscription) return;
  const payment = subscriptionPayment(invoice);
  if (
    !payment ||
    payment.customerId !== subscription.stripeCustomerId ||
    payment.stripeSubscriptionId !== subscription.stripeSubscriptionId
  )
    return;
  const event = openAiSubscriptionEvent(invoice);
  if (!event) return;
  const firstPayment = await prisma.firstPayment.findUnique({ where: { userId: subscription.userId } });
  // No historical backfill or renewals. The database ledger is authoritative.
  if (firstPayment?.stripeInvoiceId !== invoice.id) return;
  // A late older invoice can move the ledger's first payment backwards. Deduplicate
  // by customer identity so that correction cannot create a second acquisition.
  event.id = `simplepost_first_subscription_${createHash("sha256").update(subscription.userId).digest("hex")}`;

  let response: Response;
  try {
    response = await fetch(
      `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(process.env.OPENAI_ADS_PIXEL_ID!)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_CONVERSIONS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events: [event] }),
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      },
    );
  } catch {
    // Do not log request headers, hashes, the upstream response or underlying errors.
    throw new Error("OpenAI subscription measurement request failed");
  }
  if (!response.ok) throw new Error(`OpenAI subscription measurement returned HTTP ${response.status}`);
}
