import { createHash } from "node:crypto";

import {
  openAiAdsConfigured,
  openAiAdsConsentMetadata,
  openAiSubscriptionEvent,
  reportOpenAiSubscription,
} from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";

import type Stripe from "stripe";

jest.mock("@/lib/prisma", () => ({ prisma: { firstPayment: { findUnique: jest.fn() } } }));

const now = Date.parse("2026-10-28T12:00:00Z");
const subscription = { userId: "user_1", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" };
function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: "in_1",
    livemode: true,
    status: "paid",
    amount_paid: 1900,
    currency: "eur",
    customer: "cus_1",
    customer_email: " Buyer@Example.com ",
    status_transitions: { paid_at: now / 1000 },
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: "sub_1",
        metadata: { planKey: "advanced", openaiAdsConsent: "purchase-v1", openaiAdsConsentAt: String(now - 60_000) },
      },
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

describe("OpenAI subscription measurement", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
    process.env.NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED = "true";
    process.env.OPENAI_ADS_PIXEL_ID = "pixel_test";
    process.env.OPENAI_CONVERSIONS_API_KEY = "test-only-conversion-credential";
    process.env.SELF_HOSTED = "false";
    jest.mocked(prisma.firstPayment.findUnique).mockResolvedValue({ stripeInvoiceId: "in_1" } as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("sends settled minor-unit value, paid time and normalized hash without raw personal data", () => {
    const event = openAiSubscriptionEvent(invoice(), now)!;
    expect(event).toMatchObject({
      id: "simplepost_subscription_in_1",
      type: "subscription_created",
      timestamp_ms: now,
      opt_out: true,
      source_url: "https://app.simplepost.social/billing",
      user: { emails_sha256: [createHash("sha256").update("buyer@example.com").digest("hex")] },
      data: { type: "plan_enrollment", plan_id: "advanced", amount: 1900, currency: "EUR" },
    });
    expect(JSON.stringify(event)).not.toMatch(/buyer@example|Buyer@Example|cus_1|sub_1|user_1/);
    expect(openAiSubscriptionEvent(invoice(), now)?.id).toBe(event.id);
  });

  it.each([
    { livemode: false },
    { status: "open" },
    { amount_paid: 0 },
    { amount_paid: -1 },
    { customer_email: null },
    { parent: null },
    { status_transitions: { paid_at: null } },
    { status_transitions: { paid_at: now / 1000 - 7 * 86_400 } },
    { status_transitions: { paid_at: now / 1000 + 1 } },
  ])("does not report ineligible payment %j", (overrides) => {
    expect(openAiSubscriptionEvent(invoice(overrides), now)).toBeNull();
  });

  it.each([
    {},
    { openaiAdsConsent: "false" },
    { openaiAdsConsent: "purchase-v1", openaiAdsConsentAt: "NaN" },
    { openaiAdsConsent: "purchase-v1", openaiAdsConsentAt: String(now + 1) },
    { openaiAdsConsent: "purchase-v1", openaiAdsConsentAt: String(now - 1), planKey: "untrusted" },
  ])("requires valid versioned consent preceding payment and a known plan %j", (metadata) => {
    const value = invoice();
    value.parent!.subscription_details!.metadata = { planKey: "advanced", ...metadata } as Stripe.Metadata;
    expect(openAiSubscriptionEvent(value, now)).toBeNull();
  });

  it.each([
    ["NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED", "false"],
    ["OPENAI_ADS_PIXEL_ID", ""],
    ["OPENAI_CONVERSIONS_API_KEY", ""],
    ["NEXT_PUBLIC_APP_URL", "http://localhost:3000"],
    ["NEXT_PUBLIC_APP_URL", "https://preview.example.com"],
    ["SELF_HOSTED", "true"],
    ["NODE_ENV", "development"],
  ])("fails closed when %s=%s", async (name, value) => {
    process.env[name] = value;
    expect(openAiAdsConfigured()).toBe(false);
    expect(openAiAdsConsentMetadata(true, now)).toEqual({});
    await reportOpenAiSubscription(invoice(), subscription);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("records consent only on explicit opt-in with configured delivery", () => {
    expect(openAiAdsConsentMetadata(false, now)).toEqual({});
    expect(openAiAdsConsentMetadata(true, now)).toEqual({
      openaiAdsConsent: "purchase-v1",
      openaiAdsConsentAt: String(now),
    });
  });

  it("sends to the fixed endpoint with a server-only credential and bounded timeout", async () => {
    await reportOpenAiSubscription(invoice(), subscription);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://bzr.openai.com/v1/events?pid=pixel_test",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer test-only-conversion-credential" }),
        body: JSON.stringify({
          events: [
            {
              ...openAiSubscriptionEvent(invoice(), now),
              id: `simplepost_first_subscription_${createHash("sha256").update(subscription.userId).digest("hex")}`,
            },
          ],
        }),
      }),
    );
  });

  it.each([null, { stripeInvoiceId: "in_first_payment" }])(
    "does not send renewal or unknown history %j",
    async (firstPayment) => {
      jest.mocked(prisma.firstPayment.findUnique).mockResolvedValue(firstPayment as never);
      await reportOpenAiSubscription(invoice(), subscription);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...subscription, stripeCustomerId: "cus_other" },
    { ...subscription, stripeSubscriptionId: "sub_other" },
  ])("requires canonical subscription ownership %j", async (value) => {
    await reportOpenAiSubscription(invoice(), value);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails for Stripe retry without exposing upstream body or credential", async () => {
    jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 503, text: () => "sensitive response" } as never);
    await expect(reportOpenAiSubscription(invoice(), subscription)).rejects.toThrow(
      "OpenAI subscription measurement returned HTTP 503",
    );
    jest.mocked(global.fetch).mockRejectedValue(new Error("sensitive request details"));
    await expect(reportOpenAiSubscription(invoice(), subscription)).rejects.toThrow(
      "OpenAI subscription measurement request failed",
    );
  });
});
