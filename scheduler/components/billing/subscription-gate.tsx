"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CalendarClock, Sparkles } from "lucide-react";

import { BillingStatusContext, type ClientBillingStatus } from "@/components/billing/billing-context";
import { PlanSelection } from "@/components/billing/plan-selection";
import { TrialOnboardingDialogs } from "@/components/billing/trial-experience";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SelfHostedContext = createContext(false);

/** True when the instance runs with SELF_HOSTED=true and billing is disabled. */
export function useSelfHosted(): boolean {
  return useContext(SelfHostedContext);
}

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

const UNGATED_PATHS = new Set(["/subscribe", "/billing", "/billing/plans"]);

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [billing, setBilling] = useState<ClientBillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBilling = useCallback(async () => {
    const response = await fetch("/api/billing/subscription", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    setBilling((await response.json()) as ClientBillingStatus);
  }, []);

  const refreshBilling = useCallback(async () => {
    setError(null);
    try {
      await loadBilling();
    } catch (loadError) {
      console.error("Failed to refresh billing status:", loadError);
      setError(loadError instanceof Error ? loadError.message : "Failed to load billing status");
    }
  }, [loadBilling]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadInitialBilling() {
      try {
        const response = await fetch("/api/billing/subscription", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }
        const data = (await response.json()) as ClientBillingStatus;
        if (!cancelled) setBilling(data);
      } catch (loadError) {
        console.error("Failed to load billing status:", loadError);
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load billing status");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialBilling();
    return () => {
      cancelled = true;
    };
  }, []);

  const selfHosted = billing?.selfHosted === true;

  if (UNGATED_PATHS.has(pathname)) {
    return <SelfHostedContext.Provider value={selfHosted}>{children}</SelfHostedContext.Provider>;
  }

  if (loading) {
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
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
            <Button type="button" onClick={() => window.location.reload()} className="mt-5">
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (!billing?.active) {
    if (billing?.freeTrial) {
      return (
        <div className="min-h-screen overflow-hidden bg-background">
          <div aria-hidden="true" className="pointer-events-none select-none opacity-35 blur-[1px]">
            <Navbar />
            <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-10">
              <div className="h-36 rounded-2xl border border-border bg-card" />
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="h-64 rounded-2xl border border-border bg-card" />
                <div className="h-64 rounded-2xl border border-border bg-card" />
              </div>
            </main>
          </div>
          <Dialog open>
            <DialogContent showCloseButton={false} className="sm:max-w-md">
              <DialogHeader>
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <DialogTitle className="text-xl tracking-[-0.025em]">Your free trial has ended</DialogTitle>
                <DialogDescription className="leading-6">
                  Choose a plan to keep your connected accounts, scheduled posts, and AI workflows running.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border border-border bg-secondary/60 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Everything you set up is still here
                </div>
                <p className="mt-1.5 leading-5 text-muted-foreground">
                  Upgrading restores access immediately. You won’t need to reconnect your social or AI accounts.
                </p>
              </div>
              <DialogFooter>
                <Button asChild className="w-full">
                  <Link href="/billing/plans">Choose a plan</Link>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <PlanSelection displayCurrency={billing?.displayCurrency} />
      </div>
    );
  }

  return (
    <SelfHostedContext.Provider value={selfHosted}>
      <BillingStatusContext.Provider value={{ billing, refreshBilling }}>
        {children}
        <TrialOnboardingDialogs />
      </BillingStatusContext.Provider>
    </SelfHostedContext.Provider>
  );
}
