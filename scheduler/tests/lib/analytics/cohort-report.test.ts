import { buildCohortReport, type CohortAccount } from "@/lib/analytics/cohort-report";
const date = (day: number) => new Date(Date.UTC(2026, 9, day));
function user(extra: Partial<CohortAccount> = {}): CohortAccount {
  return {
    createdAt: date(1),
    acquisition: { source: "direct", measurementVersion: "funnel-v2", signupVersion: "otp", onboardingVersion: "v2" },
    activationMilestone: { socialConnectedAt: date(2), firstPostPublishedAt: date(4) },
    freeTrial: { startsAt: date(1), expiresAt: date(8) },
    firstPayment: null,
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
    { now: date(29), windowDays: 7, trialGraceDays: 7, groupBy: "trial_days" },
  );
  expect(report.rows.find((r) => r.dimensions.trialDays === "30")).toMatchObject({ expiredTrialEligible: 0 });
  expect(report.rows.find((r) => r.dimensions.trialDays === "7")).toMatchObject({
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
  expect(buildCohortReport([account], { now: date(29) }).rows[0].dimensions).toMatchObject({
    source: "direct",
    entrypoint: "assistant_authorize",
  });
  expect(
    buildCohortReport([account], { now: date(29), attribution: "last_non_direct" }).rows[0].dimensions,
  ).toMatchObject({ source: "chatgpt" });
});
it("reports totals and does not count new stages in historical cohorts", () => {
  const report = buildCohortReport(
    [
      user({ acquisition: { source: "direct" }, activationMilestone: { firstToolCalledAt: date(2) } }),
      user({ activationMilestone: { firstToolCalledAt: date(2) } }),
    ],
    { now: date(29) },
  );
  expect(report.rows).toHaveLength(1);
  expect(report.totals).toMatchObject({ signups: 2, eligible: 2, newStageEligible: 1, toolCalled: 1 });
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

it("separates authorization referrers from marketing discovery", () => {
  const report = buildCohortReport(
    [
      user({
        acquisition: {
          source: "chatgpt.com",
          sourceMethod: "referrer",
          landingPage: "/app",
          signupEntryPoint: "assistant_authorize",
        },
      }),
      user({
        acquisition: {
          source: "chatgpt.com",
          sourceMethod: "referrer",
          landingPage: "/",
          signupEntryPoint: "assistant_authorize",
        },
      }),
    ],
    { now: date(29) },
  );
  expect(report.rows.map((row) => row.dimensions.source).sort()).toEqual(["chatgpt", "chatgpt (authorization)"]);
  expect(report.totals.signups).toBe(2);
});
