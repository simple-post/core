import { getBillingStatus } from "@/lib/billing/subscriptions";

/**
 * Reading cached analytics is allowed for every authenticated user (including
 * expired trials, who keep read access to their work). Refreshing calls the
 * social platforms, so it requires an active plan or trial.
 */
export async function canRefreshAnalytics(userId: string): Promise<boolean> {
  try {
    const billing = await getBillingStatus(userId);
    return billing.active;
  } catch {
    return false;
  }
}
