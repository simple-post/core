import { NextRequest } from "next/server";

import { POST } from "@/app/api/billing/checkout/route";
import { getStripe } from "@/lib/billing/stripe";

jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn().mockResolvedValue({ id: "u_1", email: "buyer@example.com" }) } },
}));
jest.mock("@/lib/middleware/auth", () => ({
  requireBrowserSession: jest.fn().mockResolvedValue({ user: { id: "u_1" } }),
}));
jest.mock("@/lib/billing/subscriptions", () => ({
  getBillingStatus: jest.fn().mockResolvedValue({ accessType: "trial" }),
}));
jest.mock("@/lib/billing/stripe", () => ({
  getAppUrl: () => "https://app.simplepost.social",
  getOrCreateStripeCustomer: jest.fn().mockResolvedValue("cus_1"),
  getStripe: jest.fn(),
}));

describe("checkout measurement consent", () => {
  const savedEnv = { ...process.env };
  const create = jest.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test-only" });
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
    process.env.NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED = "true";
    process.env.OPENAI_ADS_PIXEL_ID = "pixel_test";
    process.env.OPENAI_CONVERSIONS_API_KEY = "test-only-key";
    process.env.STRIPE_ADVANCED_PRICE_ID = "price_test";
    process.env.SELF_HOSTED = "false";
    jest.mocked(getStripe).mockReturnValue({ checkout: { sessions: { create } } } as never);
    create.mockClear();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  async function checkout(body: unknown) {
    return POST(
      new NextRequest("https://app.simplepost.social/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it.each([{}, { adsMeasurementConsent: false }])("defaults to no consent %j", async (extra) => {
    const response = await checkout({ planKey: "advanced", ...extra });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { userId: "u_1", planKey: "advanced" },
        subscription_data: { metadata: { userId: "u_1", planKey: "advanced" } },
      }),
    );
  });

  it("writes versioned consent to checkout and subscription metadata only after opt-in", async () => {
    const response = await checkout({ planKey: "advanced", adsMeasurementConsent: true });
    expect(response.status).toBe(200);
    const params = create.mock.calls[0][0];
    expect(params.metadata).toEqual({
      userId: "u_1",
      planKey: "advanced",
      openaiAdsConsent: "purchase-v1",
      openaiAdsConsentAt: expect.stringMatching(/^\d+$/),
    });
    expect(params.subscription_data.metadata).toEqual(params.metadata);
  });

  it("does not record consent when deployment is disabled even if a client opts in", async () => {
    process.env.NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED = "false";
    const response = await checkout({ planKey: "advanced", adsMeasurementConsent: true });
    expect(response.status).toBe(200);
    expect(create.mock.calls[0][0].metadata).not.toHaveProperty("openaiAdsConsent");
  });

  it("rejects a truthy string rather than treating it as consent", async () => {
    const response = await checkout({ planKey: "advanced", adsMeasurementConsent: "true" });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
