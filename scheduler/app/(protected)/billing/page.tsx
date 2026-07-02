"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ArrowLeftRight, ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Navbar } from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_BILLING_DISPLAY_CURRENCY, type BillingDisplayCurrency } from "@/lib/billing/display-currency";
import { getBillingPlanPrice, type PlanKey } from "@/lib/billing/plans";

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

export default function BillingPage() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const checkoutSessionId = searchParams.get("session_id");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizingCheckout, setFinalizingCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState<"manage" | "invoices" | null>(null);

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
                    <h2 className="text-2xl font-semibold tracking-[-0.025em]">{plan.name}</h2>
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

                <div className="grid gap-2 sm:min-w-56">
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
          </div>
        )}
      </main>
    </div>
  );
}
