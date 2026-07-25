"use client";

import { createContext, useContext } from "react";

import type { BillingDisplayCurrency } from "@/lib/billing/display-currency";
import type { PlanKey } from "@/lib/billing/plans";

export interface ClientBillingStatus {
  active: boolean;
  accessType: "stripe" | "complimentary" | "trial" | "self_hosted" | null;
  displayCurrency: BillingDisplayCurrency;
  selfHosted?: boolean;
  plan: {
    key: PlanKey;
    name: string;
    limits: {
      socialAccounts: number | null;
      postsPerMonth: number;
      cliAccess: boolean;
      apiAccess: boolean;
    };
  } | null;
  freeTrial: {
    startsAt: string;
    expiresAt: string;
    daysRemaining: number;
    postsPerPlatform: number;
    maxThreadPosts: number;
  } | null;
  usage: {
    connectedAccounts: number;
    postsThisPeriod: number;
    postsByPlatform: Record<string, number>;
  };
}

interface BillingContextValue {
  billing: ClientBillingStatus;
  refreshBilling: () => Promise<void>;
}

export const BillingStatusContext = createContext<BillingContextValue | null>(null);

export function useBillingStatus(): BillingContextValue | null {
  return useContext(BillingStatusContext);
}
