import type { BillingStatus } from "./subscriptions";

/** Expired trials retain access to their saved work, while every write stays gated. */
export function isExpiredTrialReadOnly(
  billing: Pick<BillingStatus, "active" | "trial" | "subscription"> | null | undefined,
): boolean {
  return billing?.active === false && billing.trial?.status === "expired" && !billing.subscription;
}
