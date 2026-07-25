"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ArrowLeftRight, CreditCard, ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAccounts } from "@/hooks/use-accounts";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { getBillingPlanPrice, type PlanKey } from "@/lib/billing/plans";
import { getPlatformName } from "@/lib/config";

interface BillingPlan {
  key: PlanKey;
  name: string;
  price: string;
  prices: Record<BillingDisplayCurrency, string>;
  priceMonthly: number;
  description: string;
  featured?: boolean;
  limits: {
    socialAccounts: number | null;
    postsPerMonth: number;
    cliAccess: boolean;
    apiAccess: boolean;
  };
}

interface BillingTrial {
  status: "active" | "expired";
  startsAt: string;
  expiresAt: string;
  daysRemaining: number;
  postsPerPlatform: number;
  platformUsage: Record<string, number>;
}

interface BillingStatus {
  active: boolean;
  accessType: "stripe" | "complimentary" | "trial" | "self_hosted" | null;
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
  complimentaryAccess: {
    planKey: string;
    startsAt: string;
    expiresAt: string;
    source: string;
  } | null;
  trial: BillingTrial | null;
  usage: {
    connectedAccounts: number;
    postsThisPeriod: number;
  };
  selfHosted?: boolean;
}

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** A labelled usage bar. Every row in the usage grid uses this so they align. */
function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString()} / {limit === null ? "Unlimited" : limit.toLocaleString()}
        </span>
      </div>
      <Progress value={usagePercent(used, limit)} />
    </div>
  );
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const checkoutSessionId = searchParams.get("session_id");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizingCheckout, setFinalizingCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState<"manage" | "invoices" | null>(null);
  const { data: accounts = [] } = useAccounts();

  const loadBillingStatus = useCallback(async (): Promise<BillingStatus> => {
    const response = await fetch("/api/billing/subscription", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    return (await response.json()) as BillingStatus;
  }, []);

  const finalizeCheckoutSession = useCallback(async (sessionId: string): Promise<BillingStatus> => {
    const response = await fetch("/api/billing/finalize-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    return (await response.json()) as BillingStatus;
  }, []);

  const fetchBilling = useCallback(async () => {
    setLoading(true);
    try {
      setBilling(await loadBillingStatus());
    } catch (error) {
      console.error("Failed to load billing:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [loadBillingStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialBilling() {
      const shouldFinalizeCheckout = checkout === "success";
      setLoading(true);
      setFinalizingCheckout(shouldFinalizeCheckout);

      try {
        const attempts = shouldFinalizeCheckout ? 6 : 1;
        let latestBilling: BillingStatus | null = null;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (shouldFinalizeCheckout && checkoutSessionId && attempt === 0) {
            try {
              latestBilling = await finalizeCheckoutSession(checkoutSessionId);
            } catch (finalizeError) {
              console.error("Failed to finalize Checkout Session:", finalizeError);
              latestBilling = await loadBillingStatus();
            }
          } else {
            latestBilling = await loadBillingStatus();
          }
          if (cancelled) return;

          setBilling(latestBilling);
          if (latestBilling.active) break;

          if (attempt < attempts - 1) {
            await delay(attempt === 0 ? 650 : 900);
          }
        }
      } catch (error) {
        console.error("Failed to load billing:", error);
        toast.error(error instanceof Error ? error.message : "Failed to load billing");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setFinalizingCheckout(false);
        }
      }
    }

    void loadInitialBilling();

    return () => {
      cancelled = true;
    };
  }, [checkout, checkoutSessionId, finalizeCheckoutSession, loadBillingStatus]);

  const openPortal = async (purpose: "manage" | "invoices") => {
    setPortalLoading(purpose);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose }),
      });
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
      setPortalLoading(null);
    }
  };

  const plan = billing?.plan ?? null;
  const displayCurrency = billing?.displayCurrency ?? DEFAULT_BILLING_DISPLAY_CURRENCY;
  const accountLimit = plan?.limits.socialAccounts ?? null;
  const postLimit = plan?.limits.postsPerMonth ?? null;
  const isComplimentary = billing?.accessType === "complimentary";
  const isTrial = billing?.accessType === "trial";
  const trial = billing?.trial ?? null;
  // Platforms worth a usage row: everything connected now, plus anything already
  // charged, so posting to an account that was later disconnected still shows.
  const connectedPlatforms = useMemo(() => {
    const platforms = new Set(accounts.map((account) => account.platform));
    for (const platform of Object.keys(trial?.platformUsage ?? {})) {
      platforms.add(platform);
    }
    return [...platforms].sort();
  }, [accounts, trial]);

  if (billing?.selfHosted) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-xl flex-col items-center justify-center px-6 text-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h1 className="text-lg font-semibold tracking-[-0.025em]">Billing is disabled</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This instance runs in self-hosted mode, so there is no subscription to manage.
            </p>
            <Button asChild className="mt-5">
              <Link href="/">Back to the app</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-4xl px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 animate-reveal">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="section-kicker !mb-0">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Subscription</span>
              </div>
              <span className="h-3 w-px bg-border" />
              <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
                Plan and <span className="text-primary">billing</span>
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

        {loading ? (
          finalizingCheckout ? (
            <div className="rounded-2xl border border-border bg-card p-8">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.025em]">Finishing setup</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Your plan will be ready in a moment.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 animate-pulse">
              <div className="h-5 w-32 rounded bg-secondary" />
              <div className="mt-5 h-10 w-56 rounded bg-secondary" />
              <div className="mt-8 h-24 rounded bg-secondary" />
            </div>
          )
        ) : !billing?.active || !plan ? (
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <PlanSelection
              embedded
              title={trial ? "Your free trial has ended" : "Choose a plan to use SimplePost"}
              description={
                trial
                  ? `Your trial ran out on ${formatDate(trial.expiresAt)}. Your posts and connected accounts are still here. Pick a plan to start scheduling again.`
                  : undefined
              }
              displayCurrency={displayCurrency}
            />
          </section>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-1">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="section-kicker">
                    <span className="section-kicker-dot" />
                    <span className="section-kicker-label">
                      {isTrial ? "Free trial" : isComplimentary ? "Complimentary access" : "Current plan"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* The kicker above already says "Free trial", so name the
                        benefit here instead of repeating it. */}
                    <h2 className="text-2xl font-semibold tracking-[-0.025em]">
                      {isTrial ? "All features unlocked" : plan.name}
                    </h2>
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      {isTrial
                        ? trial && trial.daysRemaining <= 1
                          ? "Ends today"
                          : `${trial?.daysRemaining ?? 0} days left`
                        : isComplimentary
                          ? "Complimentary"
                          : (billing.subscription?.status ?? "active")}
                    </Badge>
                    {!isTrial && !isComplimentary && billing.subscription?.cancelAtPeriodEnd ? (
                      <Badge variant="outline" className="border-destructive/50 text-destructive">
                        Cancels at period end
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isTrial ? (
                      <>
                        Every feature is unlocked through {formatDate(trial?.expiresAt ?? null)}, with{" "}
                        {trial?.postsPerPlatform} posts per platform. No credit card required.
                      </>
                    ) : isComplimentary ? (
                      <>
                        Your {plan.name} plan is complimentary through{" "}
                        {formatDate(billing.complimentaryAccess?.expiresAt ?? null)}. No payment method is required.
                      </>
                    ) : (
                      <>
                        {getBillingPlanPrice(plan, displayCurrency)} / month · Current period ends{" "}
                        {formatDate(billing.subscription?.currentPeriodEnd ?? null)}
                      </>
                    )}
                  </p>
                </div>

                {/* items-start keeps every child at its own content width, so a
                    long helper line can never stretch the buttons above it. */}
                <div className="flex shrink-0 flex-col items-start gap-2">
                  {isTrial ? (
                    <>
                      <Button asChild className="gap-2">
                        <a href="#plans">
                          <CreditCard className="h-4 w-4" />
                          Choose a plan
                        </a>
                      </Button>
                      <p className="max-w-56 text-xs leading-5 text-muted-foreground">
                        Subscribing lifts the trial limits right away.
                      </p>
                    </>
                  ) : isComplimentary ? (
                    <>
                      <Button asChild className="gap-2">
                        <Link href="/subscribe">
                          <CreditCard className="h-4 w-4" />
                          Start a paid subscription
                        </Link>
                      </Button>
                      <p className="max-w-56 text-xs leading-5 text-muted-foreground">
                        Optional. Your complimentary access stays active until you subscribe or it expires.
                      </p>
                    </>
                  ) : (
                    // Three related actions read better as an even stack than at
                    // three different content widths.
                    <div className="flex w-56 flex-col gap-2">
                      <Button asChild className="justify-start gap-2">
                        <Link href="/billing/plans">
                          <ArrowLeftRight className="h-4 w-4" />
                          Change plan
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openPortal("manage")}
                        disabled={portalLoading !== null}
                        className="justify-start gap-2">
                        {portalLoading === "manage" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4" />
                        )}
                        {portalLoading === "manage" ? "Opening..." : "Manage subscription"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openPortal("invoices")}
                        disabled={portalLoading !== null}
                        className="justify-start gap-2">
                        {portalLoading === "invoices" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        {portalLoading === "invoices" ? "Opening..." : "Invoices"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-2">
              <div className="section-kicker">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Usage</span>
              </div>
              {/* One meter shape for every row, so labels and bars line up across
                  the columns no matter how many platforms are listed. */}
              <div className="grid gap-5 sm:grid-cols-2">
                <UsageMeter label="Social accounts" used={billing.usage.connectedAccounts} limit={accountLimit} />
                {isTrial && trial ? (
                  connectedPlatforms.map((platform) => (
                    <UsageMeter
                      key={platform}
                      label={`${getPlatformName(platform)} posts`}
                      used={trial.platformUsage[platform] ?? 0}
                      limit={trial.postsPerPlatform}
                    />
                  ))
                ) : (
                  <UsageMeter label="Posts this period" used={billing.usage.postsThisPeriod} limit={postLimit} />
                )}
              </div>
              {isTrial && connectedPlatforms.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Connect a social account to start using your {trial?.postsPerPlatform} posts per platform.
                </p>
              ) : null}
            </section>

            {isTrial ? (
              <section
                id="plans"
                className="scroll-mt-20 rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-2">
                <PlanSelection
                  embedded
                  title="Choose the plan that fits"
                  description="Upgrade whenever you are ready. Your paid plan starts immediately and everything you connected during the trial stays in place."
                  displayCurrency={displayCurrency}
                />
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
