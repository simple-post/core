import type { AccessPlan } from "@/lib/billing/plans";

import type { SourceCopy } from "./source-copy";

/** UI projections only: canonical plan data and checkout identifiers remain unchanged. */
export function planName(name: string, copy: SourceCopy): string {
  switch (name) {
    case "Basic": {
      return copy("Basic");
    }
    case "Advanced": {
      return copy("Advanced");
    }
    case "Pro": {
      return copy("Pro");
    }
    case "Free trial": {
      return copy("Free trial");
    }
    default: {
      return name;
    }
  }
}
export function planDescription(description: string, copy: SourceCopy): string {
  switch (description) {
    case "For solo creators posting weekly.": {
      return copy("For solo creators posting weekly.");
    }
    case "For creators and small teams publishing regularly.": {
      return copy("For creators and small teams publishing regularly.");
    }
    case "For power users, agents, and automated workflows.": {
      return copy("For power users, agents, and automated workflows.");
    }
    default: {
      return description;
    }
  }
}
export function accountLimit(plan: AccessPlan, locale: string, copy: SourceCopy): string {
  return plan.limits.socialAccounts === null
    ? copy("Unlimited")
    : new Intl.NumberFormat(locale).format(plan.limits.socialAccounts);
}
export function postLimit(plan: AccessPlan, locale: string, copy: SourceCopy): string {
  if (plan.limits.postsPerPlatform !== null)
    return copy("{{count, number}} / platform", { count: plan.limits.postsPerPlatform });
  return plan.limits.postsPerMonth === null
    ? copy("Unlimited")
    : new Intl.NumberFormat(locale).format(plan.limits.postsPerMonth);
}
export function accountAllowance(plan: AccessPlan, copy: SourceCopy): string {
  return plan.limits.socialAccounts === null
    ? copy("Unlimited social accounts")
    : copy("{{count, number}} social accounts", { count: plan.limits.socialAccounts });
}
export function postAllowance(plan: AccessPlan, copy: SourceCopy): string {
  return plan.limits.postsPerMonth === null
    ? copy("Unlimited posts / month")
    : copy("{{count, number}} posts / month", { count: plan.limits.postsPerMonth });
}

export function subscriptionStatusLabel(status: string, copy: SourceCopy) {
  switch (status) {
    case "none": {
      return copy("None");
    }
    case "active": {
      return copy("Active");
    }
    case "trialing": {
      return copy("Trial");
    }
    case "past_due": {
      return copy("Past due");
    }
    case "canceled": {
      return copy("Canceled");
    }
    case "unpaid": {
      return copy("Unpaid");
    }
    case "incomplete": {
      return copy("Incomplete");
    }
    case "incomplete_expired": {
      return copy("Incomplete and expired");
    }
    case "paused": {
      return copy("Paused");
    }
    default: {
      return status;
    }
  }
}
