"use client";

import { useState } from "react";

import { Check, Loader2 } from "lucide-react";

import { HelpLink } from "@/components/help-link";
import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UiCopy } from "@/components/ui-copy";
import { startPlanCheckout } from "@/lib/billing/checkout-client";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { BILLING_PLANS, getBillingPlanPrice, type PlanKey } from "@/lib/billing/plans";
import { planName, accountAllowance, postAllowance } from "@/lib/i18n/billing-display";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

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
  const { copy } = useUiCopy();
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const choosePlan = async (planKey: PlanKey) => {
    setLoadingPlan(planKey);
    setCheckoutError(null);
    try {
      await startPlanCheckout(planKey, copy);
    } catch (error) {
      console.error("Failed to start checkout:", error);
      setCheckoutError(error instanceof Error ? error.message : copy("Could not open checkout. Please try again."));
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
            <DialogTitle className="text-xl tracking-[-0.025em]">{copy("Your free trial has ended")}</DialogTitle>
            <DialogDescription>
              {copy(
                "Subscribe to keep creating and scheduling posts. Your saved posts and connected accounts are still here.",
              )}{" "}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {copy(
              "Posts that became due after your trial ended need your attention. After subscribing, review Failed posts and use Edit and Retry. Subscribing does not automatically send them.",
            )}{" "}
          </p>
          <HelpLink path="/billing#when-access-ends">{copy("Trial expiry and recovery help")}</HelpLink>
          {checkoutError ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
              {checkoutError}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {BILLING_PLANS.map((plan) => (
              <article
                key={plan.key}
                className={`relative flex h-full flex-col rounded-xl border p-4 ${
                  plan.featured ? "border-primary/50 bg-primary/10" : "border-border bg-background"
                }`}>
                {plan.featured ? (
                  <Badge className="absolute end-3 top-3 bg-primary text-primary-foreground hover:bg-primary">
                    {copy("Popular")}{" "}
                  </Badge>
                ) : null}

                <h3 className="text-base font-semibold text-foreground">{planName(plan.name, copy)}</h3>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                    {getBillingPlanPrice(plan, displayCurrency)}
                  </span>
                  <span className="text-xs text-muted-foreground">{copy("/ month")}</span>
                </p>

                <ul className="my-4 grid gap-1.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                    {accountAllowance(plan, copy)}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                    {postAllowance(plan, copy)}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <UiCopy
                      source="<part1></part1>Connect any AI assistant"
                      components={{ part1: <Check className="h-3 w-3 shrink-0 text-primary" /> }}
                    />
                  </li>
                </ul>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => choosePlan(plan.key)}
                  disabled={loadingPlan !== null}
                  className="mt-auto gap-2">
                  {loadingPlan === plan.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>
                    {loadingPlan === plan.key
                      ? copy("Opening Stripe...")
                      : copy("Subscribe to {{plan}}", { plan: planName(plan.name, copy) })}
                  </span>
                </Button>
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
