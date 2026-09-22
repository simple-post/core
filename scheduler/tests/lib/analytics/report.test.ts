import { buildAcquisitionReport, cohortRange, isAnalyticsAdmin, type AcquisitionAccount } from "@/lib/analytics/report";
const now = new Date("2026-09-22");
function account(overrides: Partial<AcquisitionAccount> = {}): AcquisitionAccount {
  return {
    id: "one",
    name: "Test",
    email: "test@example.com",
    createdAt: new Date("2026-09-01"),
    acquisition: { source: "chatgpt", campaign: "launch" },
    freeTrial: { startsAt: new Date("2026-09-01"), expiresAt: new Date("2026-09-08") },
    firstPayment: null,
    subscription: null,
    ...overrides,
  };
}
it("keeps recent trials out of the mature conversion denominator and includes late payments", () => {
  const payment = { paidAt: new Date("2026-09-20"), planKey: "basic" };
  const rows = buildAcquisitionReport(
    [
      account({ firstPayment: payment }),
      account(),
      account({ freeTrial: { startsAt: new Date("2026-09-21"), expiresAt: new Date("2026-09-28") } }),
      account({ freeTrial: null, firstPayment: payment }),
    ],
    now,
  );
  expect(rows[0]).toMatchObject({
    signups: 4,
    trials: 3,
    paid: 2,
    trialPaid: 1,
    running: 1,
    matureTrials: 2,
    maturePaid: 1,
    matureConversionRate: 0.5,
  });
});
it("keeps unknown attribution visible", () =>
  expect(buildAcquisitionReport([account({ acquisition: null, freeTrial: null })], now)[0]).toMatchObject({
    source: "unknown",
    matureConversionRate: null,
  }));
it("denies admin access unless the verified account ID is explicitly allowed", () => {
  expect(isAnalyticsAdmin({ id: "one", emailVerified: true }, undefined)).toBe(false);
  expect(isAnalyticsAdmin({ id: "one", emailVerified: false }, "one")).toBe(false);
  expect(isAnalyticsAdmin({ id: "one", emailVerified: true }, "someone")).toBe(false);
  expect(isAnalyticsAdmin(null, "one")).toBe(false);
  expect(isAnalyticsAdmin({ id: "one", emailVerified: true }, " two, one ")).toBe(true);
});
it("uses inclusive UTC signup dates", () =>
  expect(cohortRange("2026-09-01", "2026-09-22", now)).toMatchObject({
    start: new Date("2026-09-01"),
    end: new Date("2026-09-23"),
  }));
it.each([
  ["2026-02-30", "2026-03-01"],
  ["2026-09-22", "2026-09-01"],
  ["2024-01-01", "2026-01-01"],
])("rejects invalid cohort %s to %s", (from, to) => expect(() => cohortRange(from, to, now)).toThrow());
