import { Feature } from "@prisma/client";

import { getBillingStatus } from "@/lib/billing/subscriptions";
import { hasFeature } from "@/lib/features";
import { ForbiddenError } from "@/lib/utils/errors";

export async function requirePostAnalytics(userId: string): Promise<void> {
  if (!(await hasFeature(userId, Feature.POST_ANALYTICS)))
    throw new ForbiddenError("Post analytics is not enabled for this account.");
}

/**
 * Reading cached analytics is allowed for users with the feature (including
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
