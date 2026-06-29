"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { BILLING_PLANS, formatAccountLimit, getBillingPlanPrice, type PlanKey } from "@/lib/billing/plans";

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

interface PlanSelectionProps {
  title?: string;
  description?: string;
  displayCurrency?: BillingDisplayCurrency;
  autoStartPlanKey?: PlanKey | null;
}

export function PlanSelection({
  title = "Choose your SimplePost plan",
  description = "A subscription is required to use the scheduler. Pick a monthly plan to continue in Stripe Checkout.",
  displayCurrency = DEFAULT_BILLING_DISPLAY_CURRENCY,
  autoStartPlanKey = null,
}: PlanSelectionProps) {
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);
  const [autoStartFailed, setAutoStartFailed] = useState(false);
  const autoStartedRef = useRef(false);

  const startCheckout = useCallback(async (planKey: PlanKey) => {
    setAutoStartFailed(false);
    setLoadingPlan(planKey);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as { url?: string };
      if (!data.url) {
        throw new Error("Stripe did not return a checkout URL");
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Failed to start checkout:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
      setAutoStartFailed(true);
      setLoadingPlan(null);
    }
  }, []);

  useEffect(() => {
    if (!autoStartPlanKey || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void startCheckout(autoStartPlanKey);
  }, [autoStartPlanKey, startCheckout]);

  const autoStartPlan = autoStartPlanKey ? BILLING_PLANS.find((plan) => plan.key === autoStartPlanKey) : null;

  if (autoStartPlan && !autoStartFailed) {
    return (
      <section className="mx-auto flex min-h-[55vh] w-full max-w-2xl items-center px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
        <div className="w-full rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
            <div>
              <div className="section-kicker !mb-2">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Checkout</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Opening Stripe Checkout</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Taking you to Checkout for the {autoStartPlan.name} plan.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
      <div className="mb-7 max-w-2xl">
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Subscription</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const loading = loadingPlan === plan.key;
          return (
            <article
              key={plan.key}
              className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                plan.featured ? "border-primary/50 bg-primary/10" : "border-border bg-card"
              }`}>
              {plan.featured ? (
                <Badge className="absolute right-5 top-5 bg-primary text-primary-foreground hover:bg-primary">
                  Popular
                </Badge>
              ) : null}

              <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{plan.name}</h2>
              <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{plan.description}</p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-[-0.04em] text-foreground">
                  {getBillingPlanPrice(plan, displayCurrency)}
                </span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </p>

              <div className="my-6 grid gap-3 rounded-xl border border-border bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Social accounts</span>
                  <span className="font-medium text-foreground">{formatAccountLimit(plan)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Posts per month</span>
                  <span className="font-medium text-foreground">{plan.limits.postsPerMonth.toLocaleString()}</span>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => startCheckout(plan.key)}
                disabled={loadingPlan !== null}
                className="mt-auto gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Opening Stripe..." : `Choose ${plan.name}`}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
