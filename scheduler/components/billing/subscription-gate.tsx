"use client";

import { createContext, useContext, type ReactNode } from "react";

import { usePathname } from "next/navigation";

import { PlanSelection } from "@/components/billing/plan-selection";
import { TrialExpiredDialog } from "@/components/billing/trial-expired-dialog";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";

const SelfHostedContext = createContext(false);

/** True when the instance runs with SELF_HOSTED=true and billing is disabled. */
export function useSelfHosted(): boolean {
  return useContext(SelfHostedContext);
}

const UNGATED_PATHS = new Set(["/subscribe", "/billing", "/billing/plans"]);

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Shared with the trial banner, compose-form allowance, and welcome modal, so
  // the whole app reads one cached copy of the billing status per page load.
  const { data: billing, error, isPending } = useBillingStatus();

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

  // A finished trial gets a blocking dialog over an inert impression of the
  // workspace, rather than the plan wall a never-subscribed user would see.
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
