import type { BillingStatus } from "@/lib/billing/subscriptions";

export function getOnboardingTrialDays(billing: Pick<BillingStatus, "accessType" | "trial"> | undefined) {
  const trial = billing?.accessType === "trial" ? billing.trial : null;
  if (!trial) return null;
  return Math.round((Date.parse(trial.expiresAt) - Date.parse(trial.startsAt)) / 86_400_000);
}
