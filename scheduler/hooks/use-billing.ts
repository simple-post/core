"use client";

import { useQuery } from "@tanstack/react-query";

import type { BillingDisplayCurrency } from "@/lib/billing/display-currency";
import type { BillingStatus } from "@/lib/billing/subscriptions";
import { queryKeys } from "@/lib/query-client";

/** Shape of `GET /api/billing/subscription`: the billing status plus request-derived extras. */
export interface BillingStatusResponse extends BillingStatus {
  displayCurrency: BillingDisplayCurrency;
  selfHosted?: boolean;
}

async function fetchBillingStatus(): Promise<BillingStatusResponse> {
  const response = await fetch("/api/billing/subscription", { cache: "no-store" });
  if (!response.ok) {
    // SubscriptionGate renders this message, so keep the server's wording.
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as BillingStatusResponse;
}

/**
 * Billing status for UI that reacts to the plan (trial banners, per-platform
 * allowance on the compose form). Kept short-lived because posting changes the
 * trial usage numbers this returns.
 */
export function useBillingStatus() {
  return useQuery({
    queryKey: queryKeys.billing,
    queryFn: fetchBillingStatus,
    staleTime: 30 * 1000,
  });
}
