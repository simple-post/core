"use client";

import { useState } from "react";

import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { HelpLink } from "@/components/help-link";
import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { startPlanCheckout } from "@/lib/billing/checkout-client";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import {
  BILLING_PLANS,
  formatAccountLimit,
  formatPostLimit,
  getBillingPlanPrice,
  type PlanKey,
} from "@/lib/billing/plans";

/**
 * Inert stand-in for the app behind the dialog. Rendering the real dashboard
 * here would fire a wave of requests that all 402. This keeps the sense of
 * "your workspace is still there" without the failed calls and error logs.
 */
function BlurredWorkspace() {
  return (
    <div aria-hidden="true" className="pointer-events-none select-none opacity-35 blur-[2px]">
      <Navbar />
      <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-10">
        <div className="h-36 rounded-2xl border border-border bg-card" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="h-64 rounded-2xl border border-border bg-card" />
          <div className="h-64 rounded-2xl border border-border bg-card" />
        </div>
      </main>
    </div>
  );
}

/**
 * Takes over the app once the free trial has ended and nothing replaced it.
 * Deliberately not dismissible: every posting API already returns 402 at this
 * point, so letting the user click past it would only produce dead ends.
 * SubscriptionGate keeps /billing and /billing/plans reachable underneath.
 */
export function TrialExpiredDialog({
  displayCurrency = DEFAULT_BILLING_DISPLAY_CURRENCY,
}: {
  displayCurrency?: BillingDisplayCurrency;
}) {
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);

  const choosePlan = async (planKey: PlanKey) => {
    setLoadingPlan(planKey);
    try {
      await startPlanCheckout(planKey);
    } catch (error) {
      console.error("Failed to start checkout:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-background">
      <BlurredWorkspace />
      <Dialog open>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">Your free trial has ended</DialogTitle>
            <DialogDescription>
              Your stored posts and account connections remain saved. Posts that become due without active access fail;
              subscribing does not automatically send them. After subscribing, review Failed posts and use Edit and
              Retry.
            </DialogDescription>
          </DialogHeader>

          <HelpLink path="/billing#when-access-ends">Trial expiry and recovery help</HelpLink>
          <div className="grid gap-3 sm:grid-cols-3">
            {BILLING_PLANS.map((plan) => (
              <article
                key={plan.key}
                className={`relative flex h-full flex-col rounded-xl border p-4 ${
                  plan.featured ? "border-primary/50 bg-primary/10" : "border-border bg-background"
                }`}>
                {plan.featured ? (
                  <Badge className="absolute right-3 top-3 bg-primary text-primary-foreground hover:bg-primary">
                    Popular
                  </Badge>
                ) : null}

                <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                    {getBillingPlanPrice(plan, displayCurrency)}
                  </span>
                  <span className="text-xs text-muted-foreground">/ month</span>
                </p>

                <ul className="my-4 grid gap-1.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                    {formatAccountLimit(plan)} social accounts
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                    {formatPostLimit(plan)} posts / month
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                    Connect any AI assistant
                  </li>
                </ul>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => choosePlan(plan.key)}
                  disabled={loadingPlan !== null}
                  className="mt-auto gap-2">
                  {loadingPlan === plan.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {loadingPlan === plan.key ? "Opening Stripe..." : `Choose ${plan.name}`}
                </Button>
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
