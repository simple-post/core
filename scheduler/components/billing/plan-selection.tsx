"use client";

import { useCallback, useState } from "react";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startPlanCheckout } from "@/lib/billing/checkout-client";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import {
  BILLING_PLANS,
  formatAccountLimit,
  formatPostLimit,
  getBillingPlanPrice,
  type PlanKey,
} from "@/lib/billing/plans";

interface PlanSelectionProps {
  title?: string;
  description?: string;
  displayCurrency?: BillingDisplayCurrency;
  selectedPlanKey?: PlanKey | null;
  /**
   * Drop the page-level width and padding so the grid can sit inside an
   * existing card or section instead of owning the page.
   */
  embedded?: boolean;
}

export function PlanSelection({
  title = "Choose your SimplePost plan",
  description = "A subscription is required to use the scheduler. Pick a monthly plan to continue in Stripe Checkout.",
  displayCurrency = DEFAULT_BILLING_DISPLAY_CURRENCY,
  selectedPlanKey = null,
  embedded = false,
}: PlanSelectionProps) {
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);

  const startCheckout = useCallback(async (planKey: PlanKey) => {
    setLoadingPlan(planKey);
    try {
      await startPlanCheckout(planKey);
    } catch (error) {
      console.error("Failed to start checkout:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
      setLoadingPlan(null);
    }
  }, []);

  return (
    <section className={embedded ? "w-full" : "mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12"}>
      <div className={embedded ? "mb-5 max-w-2xl" : "mb-7 max-w-2xl"}>
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Subscription</span>
        </div>
        {embedded ? (
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{title}</h2>
        ) : (
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">{title}</h1>
        )}
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const loading = loadingPlan === plan.key;
          return (
            <article
              key={plan.key}
              className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                plan.key === selectedPlanKey || plan.featured
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card"
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
                  <span className="font-medium text-foreground">{formatPostLimit(plan)}</span>
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
