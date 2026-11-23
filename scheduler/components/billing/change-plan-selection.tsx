"use client";

import { useEffect, useState } from "react";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { BILLING_PLANS, getBillingPlanPrice, getPlanByKey, type PlanKey } from "@/lib/billing/plans";
import { planName, planDescription, accountLimit, postLimit } from "@/lib/i18n/billing-display";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

interface BillingStatusResponse {
  active: boolean;
  displayCurrency: BillingDisplayCurrency;
  plan: {
    key: PlanKey;
  } | null;
}

interface ChangePlanSelectionProps {
  currentPlanKey: PlanKey;
  displayCurrency?: BillingDisplayCurrency;
  onPlanChanged?: (billing: BillingStatusResponse) => void;
}

async function parseApiError(response: Response, copy: SourceCopy): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || copy("Request failed with status {{status}}", { status: response.status });
}

export function ChangePlanSelection({
  currentPlanKey,
  displayCurrency = DEFAULT_BILLING_DISPLAY_CURRENCY,
  onPlanChanged,
}: ChangePlanSelectionProps) {
  const { copy, locale } = useUiCopy();
  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey>(currentPlanKey);
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);

  useEffect(() => {
    setSelectedPlanKey(currentPlanKey);
  }, [currentPlanKey]);

  const currentPlan = getPlanByKey(selectedPlanKey);
  const pendingPlan = getPlanByKey(pendingPlanKey);

  const getActionVerb = (planKey: PlanKey) => {
    const plan = getPlanByKey(planKey);
    if (!currentPlan || !plan) return "Change";
    if (plan.priceMonthly > currentPlan.priceMonthly) return "Upgrade";
    if (plan.priceMonthly < currentPlan.priceMonthly) return "Downgrade";
    return "Change";
  };

  const changePlan = async (planKey: PlanKey) => {
    if (planKey === selectedPlanKey) return;

    setLoadingPlan(planKey);
    try {
      const response = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, copy));
      }

      const data = (await response.json()) as BillingStatusResponse;
      setSelectedPlanKey(data.plan?.key ?? planKey);
      onPlanChanged?.(data);
      toast.success(copy("Plan updated"));
    } catch (error) {
      console.error("Failed to update plan:", error);
      toast.error(error instanceof Error ? error.message : copy("Failed to update plan"));
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] py-10 sm:py-12">
      <div className="mb-7 max-w-2xl">
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">{copy("Subscription")}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
          {copy("Change your SimplePost plan")}{" "}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {copy(
            "Choose a new monthly plan. Upgrades and downgrades are applied in Stripe and reflected here immediately.",
          )}{" "}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const loading = loadingPlan === plan.key;
          const isCurrentPlan = selectedPlanKey === plan.key;
          const actionVerb = getActionVerb(plan.key);
          const name = planName(plan.name, copy);

          return (
            <article
              key={plan.key}
              className="relative flex h-full flex-col rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
                  {planName(plan.name, copy)}
                </h2>
                {isCurrentPlan ? <Badge variant="outline">{copy("Current")}</Badge> : null}
              </div>
              <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">
                {planDescription(plan.description, copy)}
              </p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-[-0.04em] text-foreground">
                  {getBillingPlanPrice(plan, displayCurrency)}
                </span>
                <span className="text-sm text-muted-foreground">{copy("/ month")}</span>
              </p>

              <div className="my-6 grid gap-3 rounded-xl border border-border bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{copy("Social accounts")}</span>
                  <span className="font-medium text-foreground">{accountLimit(plan, locale, copy)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{copy("Posts per month")}</span>
                  <span className="font-medium text-foreground">{postLimit(plan, locale, copy)}</span>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => setPendingPlanKey(plan.key)}
                disabled={loadingPlan !== null || isCurrentPlan}
                variant={isCurrentPlan ? "outline" : "default"}
                className="mt-auto gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>
                  {isCurrentPlan
                    ? copy("Current plan")
                    : loading
                      ? copy("Updating...")
                      : actionVerb === "Upgrade"
                        ? copy("Upgrade to {{plan}}", { plan: name })
                        : actionVerb === "Downgrade"
                          ? copy("Downgrade to {{plan}}", { plan: name })
                          : copy("Change to {{plan}}", { plan: name })}
                </span>
              </Button>
            </article>
          );
        })}
      </div>

      <AlertDialog
        open={pendingPlanKey !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlanKey(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingPlan && getActionVerb(pendingPlan.key) === "Upgrade"
                ? copy("Confirm upgrade")
                : pendingPlan && getActionVerb(pendingPlan.key) === "Downgrade"
                  ? copy("Confirm downgrade")
                  : copy("Confirm plan change")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPlan && currentPlan
                ? copy(
                    "Your plan will change from {{current}} to {{pending}}. Stripe will apply any prorations automatically.",
                    { current: planName(currentPlan.name, copy), pending: planName(pendingPlan.name, copy) },
                  )
                : copy("Your subscription will be updated in Stripe.")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingPlan ? (
            <div className="rounded-xl border border-border bg-secondary p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{planName(pendingPlan.name, copy)}</span>
                <span className="text-muted-foreground">
                  {copy("{{price}} / month", { price: getBillingPlanPrice(pendingPlan, displayCurrency) })}
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{copy("Social accounts")}</span>
                  <span>{accountLimit(pendingPlan, locale, copy)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{copy("Posts per month")}</span>
                  <span>{postLimit(pendingPlan, locale, copy)}</span>
                </div>
              </div>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingPlan !== null}>{copy("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingPlan || loadingPlan !== null}
              onClick={() => {
                if (pendingPlan) {
                  void changePlan(pendingPlan.key);
                }
              }}>
              {pendingPlan && getActionVerb(pendingPlan.key) === "Upgrade"
                ? copy("Upgrade plan")
                : pendingPlan && getActionVerb(pendingPlan.key) === "Downgrade"
                  ? copy("Downgrade plan")
                  : pendingPlan
                    ? copy("Change plan")
                    : copy("Confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
