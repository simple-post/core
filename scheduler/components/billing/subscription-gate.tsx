"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

import { usePathname } from "next/navigation";

import { PlanSelection } from "@/components/billing/plan-selection";
import { TrialExpiredDialog } from "@/components/billing/trial-expired-dialog";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";
import { trackOnce } from "@/lib/analytics/plausible";
import { useSession } from "@/lib/auth/auth-client";
import { isExpiredTrialReadOnly } from "@/lib/billing/read-only";

const SelfHostedContext = createContext(false);

/** True when the instance runs with SELF_HOSTED=true and billing is disabled. */
export function useSelfHosted(): boolean {
  return useContext(SelfHostedContext);
}

const UNGATED_PATHS = new Set(["/subscribe", "/billing", "/billing/plans"]);

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Shared with the trial banner and compose-form allowance, so
  // the whole app reads one cached copy of the billing status per page load.
  const { data: billing, error, isPending } = useBillingStatus();

  const { data: session } = useSession();
  useEffect(() => {
    if (!billing || billing.selfHosted || !session) return;
    trackOnce(`authenticated:${session.session.id}:${billing.accessType}`, "Authenticated Visit", {
      access_type: billing.accessType || "inactive",
      plan: billing.plan?.key || "none",
      subscription_status: billing.subscription?.status || "none",
    });
  }, [billing, session]);

  const selfHosted = billing?.selfHosted === true;

  if (UNGATED_PATHS.has(pathname)) {
    return <SelfHostedContext.Provider value={selfHosted}>{children}</SelfHostedContext.Provider>;
  }

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-xl flex-col items-center justify-center px-6 text-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h1 className="text-lg font-semibold tracking-[-0.025em]">Billing status unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{error.message}</p>
            <Button type="button" onClick={() => window.location.reload()} className="mt-5">
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // Only saved-data views are available after expiry. Composer and settings
  // routes keep the existing upgrade screen; API writes are gated separately.
  if (
    isExpiredTrialReadOnly(billing) &&
    (pathname === "/" || pathname === "/accounts" || /^\/posts\/[^/]+$/.test(pathname))
  ) {
    return children;
  }

  if (!billing?.active && billing?.trial) {
    return <TrialExpiredDialog displayCurrency={billing.displayCurrency} />;
  }

  // No trial and no plan: a lapsed paid subscription, or a user whose trial was
  // never created. The full pricing page is the only sensible destination.
  if (!billing?.active) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <PlanSelection displayCurrency={billing?.displayCurrency} />
      </div>
    );
  }

  return <SelfHostedContext.Provider value={selfHosted}>{children}</SelfHostedContext.Provider>;
}
