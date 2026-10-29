import { buildCohortReport, type CohortAccount } from "@/lib/analytics/cohort-report";
const date = (day: number) => new Date(Date.UTC(2026, 9, day));
function user(extra: Partial<CohortAccount> = {}): CohortAccount {
  return {
    createdAt: date(1),
    acquisition: { source: "direct", measurementVersion: "funnel-v2", signupVersion: "otp", onboardingVersion: "v2" },
    activationMilestone: { socialConnectedAt: date(2), firstPostPublishedAt: date(4) },
    freeTrial: { startsAt: date(1), expiresAt: date(8) },
    firstPayment: null,
    subscription: null,
    ...extra,
  };
}
it("uses equal per-person observation windows and excludes immature users", () => {
  const report = buildCohortReport(
    [
      user({ firstPayment: { paidAt: date(16) } }),
      user({ createdAt: date(27), activationMilestone: { socialConnectedAt: date(28) } }),
    ],
    { now: date(29), windowDays: 7 },
  );
  const rows = report.rows;
  expect(rows.reduce((n, r) => n + r.eligible, 0)).toBe(1);
  expect(rows.reduce((n, r) => n + r.immature, 0)).toBe(1);
  expect(rows[0]).toMatchObject({ eligible: 1, paid: 0, published: 1, socialConnected: 1 });
});
it("waits for actual 30-day expiry plus payment grace and classifies loss at expiry", () => {
  const report = buildCohortReport(
    [
      user({ createdAt: date(1), freeTrial: { startsAt: date(1), expiresAt: date(31) } }),
      user({ activationMilestone: { socialConnectedAt: date(3), firstPostPublishedAt: date(10) } }),
    ],
    { now: date(29), windowDays: 7, trialGraceDays: 7 },
  );
  expect(report.rows.find((r) => r.trialDays === "30")).toMatchObject({ expiredTrialEligible: 0 });
  expect(report.rows.find((r) => r.trialDays === "7")).toMatchObject({
    expiredTrialEligible: 1,
    expiredUnpaidSocialNoPublish: 1,
    expiredUnpaidPublished: 0,
  });
});
it("never replaces direct first touch with an inferred assistant source", () => {
  const account = user({
    acquisition: {
      source: "direct",
      signupEntryPoint: "assistant_authorize",
      lastNonDirect: { source: "chatgpt.com", landingPage: "/" },
    },
  });
  expect(buildCohortReport([account], { now: date(29) }).rows[0]).toMatchObject({
    source: "direct",
    entrypoint: "assistant_authorize",
  });
  expect(buildCohortReport([account], { now: date(29), attribution: "last_non_direct" }).rows[0]).toMatchObject({
    source: "chatgpt",
  });
});
it("does not combine different onboarding or trial policies", () => {
  const report = buildCohortReport([user(), user({ acquisition: { source: "direct", onboardingVersion: "v3" } })], {
    now: date(29),
  });
  expect(report.rows).toHaveLength(2);
});
it("does not count events before signup or after the fixed deadline", () => {
  const report = buildCohortReport(
    [
      user({
        activationMilestone: { aiConnectedAt: date(0), socialConnectedAt: date(10), firstPostPublishedAt: date(29) },
      }),
    ],
    { now: date(29), windowDays: 7 },
  );
  expect(report.rows[0]).toMatchObject({ eligible: 1, aiConnected: 0, socialConnected: 0, published: 0 });
});
