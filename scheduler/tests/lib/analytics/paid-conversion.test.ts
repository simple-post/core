import { paidConversion } from "@/lib/analytics/paid-conversion";
import { analyticsUrl } from "@/lib/analytics/plausible";

const now = Date.now();
const checkout: Parameters<typeof paidConversion>[0] = {
  mode: "subscription",
  status: "complete",
  payment_status: "paid",
  livemode: true,
  amount_total: 1900,
  created: Math.floor(now / 1000),
  metadata: { planKey: "basic" },
};

describe("paid conversion", () => {
  it("reports a settled live subscription with only its plan", () => {
    expect(paidConversion(checkout, now)).toEqual({ plan: "basic" });
  });
  it.each([
    { status: "open" },
    { payment_status: "unpaid" },
    { payment_status: "no_payment_required" },
    { amount_total: 0 },
    { amount_total: null },
    { livemode: false },
    { mode: "payment" },
    { metadata: {} },
    { metadata: { planKey: "untrusted" } },
    { created: now / 1000 - 86_401 },
  ])("does not count invalid or stale checkout %j", (overrides) => {
    expect(paidConversion({ ...checkout, ...overrides } as typeof checkout, now)).toBeNull();
  });
});

describe("analytics URL privacy", () => {
  it("removes checkout IDs, auth tokens and fragments but retains campaign attribution", () => {
    expect(
      analyticsUrl(
        "https://app.simplepost.social/billing?session_id=cs_secret&token=secret&utm_source=newsletter#private",
      ),
    ).toBe("https://app.simplepost.social/app/billing?utm_source=newsletter");
  });
  it("removes dynamic post and account IDs", () => {
    expect(analyticsUrl("https://app.simplepost.social/posts/private-id/edit")).toBe(
      "https://app.simplepost.social/app/posts",
    );
    expect(analyticsUrl("https://app.simplepost.social/accounts/private-id")).toBe(
      "https://app.simplepost.social/app/accounts",
    );
  });
  it("groups unknown paths and distinguishes app home from the marketing home", () => {
    expect(analyticsUrl("https://app.simplepost.social/invite/private-token")).toBe(
      "https://app.simplepost.social/app/other",
    );
    expect(analyticsUrl("https://app.simplepost.social/")).toBe("https://app.simplepost.social/app");
  });
});
