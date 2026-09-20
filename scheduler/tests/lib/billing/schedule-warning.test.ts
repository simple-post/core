import { getTrialExpiryScheduleWarning, TRIAL_EXPIRY_SCHEDULE_WARNING } from "@/lib/billing/schedule-warning";

const billing = {
  accessType: "trial",
  trial: {
    status: "active" as const,
    expiresAt: "2026-09-25T12:00:00.000Z",
  },
};

it("warns when a trial post is due at or after trial expiry", () => {
  for (const scheduledFor of ["2026-09-25T12:00:00.000Z", new Date("2026-09-26T12:00:00.000Z")]) {
    expect(getTrialExpiryScheduleWarning(billing, scheduledFor)).toEqual({
      code: TRIAL_EXPIRY_SCHEDULE_WARNING,
      message: expect.stringContaining("will not publish"),
      trialExpiresAt: billing.trial.expiresAt,
    });
  }
});

it("does not warn before expiry or for non-trial access", () => {
  expect(getTrialExpiryScheduleWarning(billing, "2026-09-25T11:59:59.999Z")).toBeNull();
  expect(getTrialExpiryScheduleWarning({ ...billing, accessType: "stripe" }, "2026-09-26T12:00:00.000Z")).toBeNull();
  expect(
    getTrialExpiryScheduleWarning({ ...billing, trial: { ...billing.trial, status: "expired" } }, new Date()),
  ).toBe(null);
});
