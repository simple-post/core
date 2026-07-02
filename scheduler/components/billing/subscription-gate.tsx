"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { usePathname } from "next/navigation";

import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { type BillingDisplayCurrency } from "@/lib/billing/display-currency";

interface BillingStatusResponse {
  active: boolean;
  displayCurrency: BillingDisplayCurrency;
  selfHosted?: boolean;
}

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
  const [billing, setBilling] = useState<BillingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBilling() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/billing/subscription", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const data = (await response.json()) as BillingStatusResponse;
        if (!cancelled) {
          setBilling(data);
        }
      } catch (loadError) {
        console.error("Failed to load billing status:", loadError);
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load billing status");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBilling();

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
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <PlanSelection displayCurrency={billing?.displayCurrency} />
      </div>
    );
  }

  return <SelfHostedContext.Provider value={selfHosted}>{children}</SelfHostedContext.Provider>;
}
