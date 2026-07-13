"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { ChangePlanSelection } from "@/components/billing/change-plan-selection";
import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { type PlanKey } from "@/lib/billing/plans";

interface BillingStatus {
  active: boolean;
  accessType: "stripe" | "complimentary" | "self_hosted" | null;
  displayCurrency: BillingDisplayCurrency;
  plan: {
    key: PlanKey;
    name: string;
  } | null;
  complimentaryAccess: {
    expiresAt: string;
  } | null;
  selfHosted?: boolean;
}

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "its configured end date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function BillingPlansPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBilling = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/billing/subscription", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }
      setBilling((await response.json()) as BillingStatus);
    } catch (error) {
      console.error("Failed to load billing:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBilling();
  }, [fetchBilling]);

  const displayCurrency = billing?.displayCurrency ?? DEFAULT_BILLING_DISPLAY_CURRENCY;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
          <div className="flex items-center justify-between gap-4">
            <BackLink href="/billing" label="Back to subscription" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchBilling}
              disabled={loading}
              className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {loading ? (
          <section className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
            <div className="rounded-2xl border border-border bg-card p-8">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading plans...</p>
              </div>
            </div>
          </section>
        ) : billing?.selfHosted ? (
          <section className="mx-auto w-full max-w-2xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              <h1 className="text-xl font-semibold tracking-[-0.025em]">Billing is disabled</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                This instance runs in self-hosted mode, so there are no plans to manage.
              </p>
              <Button asChild className="mt-5">
                <Link href="/">Back to the app</Link>
              </Button>
            </div>
          </section>
        ) : billing?.accessType === "complimentary" && billing.plan ? (
          <PlanSelection
            title="Start a paid subscription"
            description={`You currently have complimentary ${billing.plan.name} access through ${formatDate(billing.complimentaryAccess?.expiresAt)}. No payment method is required for that access; choose a plan here only if you want to start a paid subscription now.`}
            displayCurrency={displayCurrency}
          />
        ) : !billing?.active || !billing.plan ? (
          <section className="mx-auto w-full max-w-2xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              <div className="section-kicker">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">No active plan</span>
              </div>
              <h1 className="text-xl font-semibold tracking-[-0.025em]">Choose a plan first</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Plan changes are available after your first subscription is active.
              </p>
              <Button asChild className="mt-5">
                <Link href="/subscribe">Choose a plan</Link>
              </Button>
            </div>
          </section>
        ) : (
          <ChangePlanSelection
            currentPlanKey={billing.plan.key}
            displayCurrency={displayCurrency}
            onPlanChanged={() => void fetchBilling()}
          />
        )}
      </main>
    </div>
  );
}
