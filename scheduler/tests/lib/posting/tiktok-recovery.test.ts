import { getTikTokPostRecovery, recoveryForResult, tomorrowRetryTime } from "@/lib/posting/tiktok-recovery";

it.each(["spam_risk_too_many_pending_share", "spam_risk_too_many_posts", "reached_active_user_cap"])(
  "offers a user-approved retry for %s",
  (code) => {
    const recovery = getTikTokPostRecovery({
      status: "failed",
      errorDetails: { failedPlatforms: [{ platform: "tiktok", error: "PUBLISH_REJECTED", details: { code } }] },
    });
    expect(recovery).toMatchObject({
      code,
      automaticRetry: false,
      canScheduleRetry: true,
      actions: ["retry_tomorrow", "choose_time", "spread_over_days"],
    });
    expect(recovery?.instructions).toContain("do not create a duplicate");
  },
);

it("shows the scheduled minute-limit recovery as automatic", () => {
  expect(recoveryForResult({ platform: "tiktok", error: "LOCAL_RATE_LIMIT" }, true)).toMatchObject({
    code: "rate_limit_exceeded",
    automaticRetry: true,
  });
});

it("does not offer a retry for uncertain, mixed, banned or already completed posts", () => {
  const cap = { platform: "tiktok", error: "PUBLISH_REJECTED", details: { code: "spam_risk_too_many_pending_share" } };
  for (const error of ["API_ERROR", "PUBLISH_OUTCOME_UNKNOWN"])
    expect(recoveryForResult({ ...cap, error })).toBeUndefined();
  expect(getTikTokPostRecovery({ status: "published", errorDetails: { failedPlatforms: [cap] } })).toBeUndefined();
  expect(
    getTikTokPostRecovery({
      status: "failed",
      errorDetails: { failedPlatforms: [cap, { platform: "x", error: "API_ERROR" }] },
    }),
  ).toBeUndefined();
  expect(recoveryForResult({ ...cap, details: { code: "spam_risk_user_banned_from_posting" } })).toBeUndefined();
});

it("uses tomorrow at 09:00 in the user's local calendar", () => {
  const tomorrow = tomorrowRetryTime(new Date(2026, 9, 24, 23, 15));
  expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([25, 9, 0]);
});
