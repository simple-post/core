"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { CreditCard, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { getBillingPlanPrice } from "@/lib/billing/plans";

interface BillingPlan {
  key: string;
  name: string;
  price: string;
  prices: Record<BillingDisplayCurrency, string>;
  limits: {
    socialAccounts: number | null;
    postsPerMonth: number;
    cliAccess: boolean;
    apiAccess: boolean;
  };
}

interface BillingStatus {
  active: boolean;
  displayCurrency: BillingDisplayCurrency;
  plan: BillingPlan | null;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    trialEndsAt: string | null;
  } | null;
  usage: {
    connectedAccounts: number;
    postsThisPeriod: number;
  };
}

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function usagePercent(value: number, limit: number | null) {
  if (!limit) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

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
    fetchBilling();
  }, [fetchBilling]);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as { url?: string };
      if (!data.url) {
        throw new Error("Stripe did not return a portal URL");
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Failed to open Stripe portal:", error);
      toast.error(error instanceof Error ? error.message : "Failed to open Stripe portal");
      setPortalLoading(false);
    }
  };

  const plan = billing?.plan ?? null;
  const displayCurrency = billing?.displayCurrency ?? DEFAULT_BILLING_DISPLAY_CURRENCY;
  const accountLimit = plan?.limits.socialAccounts ?? null;
  const postLimit = plan?.limits.postsPerMonth ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-4xl px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 space-y-3 animate-reveal">
          <BackLink />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="section-kicker !mb-0">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Billing</span>
              </div>
              <span className="h-3 w-px bg-border" />
              <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
                Plan <span className="text-primary">and billing</span>
              </h1>
            </div>
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

        {checkout === "success" ? (
          <Alert className="mb-5 border-primary/40 bg-primary/10">
            <AlertTitle>Checkout complete</AlertTitle>
            <AlertDescription>
              Stripe is confirming your subscription. If this page has not updated yet, refresh in a few seconds.
            </AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-8 animate-pulse">
            <div className="h-5 w-32 rounded bg-secondary" />
            <div className="mt-5 h-10 w-56 rounded bg-secondary" />
            <div className="mt-8 h-24 rounded bg-secondary" />
          </div>
        ) : !billing?.active || !plan ? (
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">No active plan</span>
            </div>
            <h2 className="text-xl font-semibold tracking-[-0.025em]">Choose a plan to use SimplePost</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your account is signed in, but the scheduler requires an active subscription.
            </p>
            <Button asChild className="mt-5">
              <Link href="/subscribe">Choose a plan</Link>
            </Button>
          </section>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-1">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="section-kicker">
                    <span className="section-kicker-dot" />
                    <span className="section-kicker-label">Current plan</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-3xl font-semibold tracking-[-0.04em]">{plan.name}</h2>
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      {billing.subscription?.status ?? "active"}
                    </Badge>
                    {billing.subscription?.cancelAtPeriodEnd ? (
                      <Badge variant="outline" className="border-destructive/50 text-destructive">
                        Cancels at period end
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {getBillingPlanPrice(plan, displayCurrency)} / month · Current period ends{" "}
                    {formatDate(billing.subscription?.currentPeriodEnd ?? null)}
                  </p>
                </div>

                <Button type="button" onClick={openPortal} disabled={portalLoading} className="gap-2">
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  {portalLoading ? "Opening..." : "Manage in Stripe"}
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-2">
              <div className="section-kicker">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Usage</span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">Social accounts</span>
                    <span className="text-muted-foreground">
                      {billing.usage.connectedAccounts} / {accountLimit ?? "Unlimited"}
                    </span>
                  </div>
                  <Progress value={usagePercent(billing.usage.connectedAccounts, accountLimit)} />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">Posts this period</span>
                    <span className="text-muted-foreground">
                      {billing.usage.postsThisPeriod.toLocaleString()} / {postLimit?.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={usagePercent(billing.usage.postsThisPeriod, postLimit)} />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-3">
              <div className="section-kicker">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Included</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Web app", "Included"],
                  ["CLI", plan.limits.cliAccess ? "Included" : "Not included"],
                  ["API", plan.limits.apiAccess ? "Included" : "Pro only"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-secondary p-4">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
