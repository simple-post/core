"use client";

import { useMemo } from "react";

import Link from "next/link";

import { Sparkles } from "lucide-react";

import { LowAllowanceWarning, LOW_REMAINING } from "@/components/billing/trial-post-allowance";
import { HelpLink } from "@/components/help-link";
import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";
import { getPlatformName } from "@/lib/config";

function formatDaysRemaining(days: number): string {
  if (days <= 0) return "Ends today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/**
 * Free-trial status on the dashboard: time left, the upgrade path, and a
 * warning once a platform is nearly used up. Per-platform counts are tracked
 * server-side but stay off screen until they start to matter.
 *
 * Renders nothing for paying users and for the expired trial, which the
 * blocking dialog in SubscriptionGate handles instead.
 */
export function TrialBanner() {
  const { data: billing } = useBillingStatus();
  const trial = billing?.accessType === "trial" ? (billing.trial ?? null) : null;

  const lowPlatforms = useMemo(() => {
    if (!trial) return [];
    return Object.entries(trial.platformUsage)
      .map(([platform, used]) => ({
        label: getPlatformName(platform),
        remaining: Math.max(0, trial.postsPerPlatform - used),
      }))
      .filter((entry) => entry.remaining < LOW_REMAINING)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [trial]);

  if (!trial || trial.status !== "active") {
    return null;
  }

  return (
    <section className="mb-6 space-y-3 animate-reveal">
      <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-background text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold tracking-[-0.025em] text-foreground">
                You are on the free trial. {formatDaysRemaining(trial.daysRemaining)}.
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Every feature is unlocked, with {trial.postsPerPlatform} posts per platform. No credit card needed.
            </p>
          </div>

          <HelpLink path="/billing#free-trial">Trial limits and expiry</HelpLink>
          <Button asChild className="shrink-0">
            <Link href="/billing/plans">Choose a plan</Link>
          </Button>
        </div>
      </div>

      <LowAllowanceWarning
        platforms={lowPlatforms.map((entry) => entry.label)}
        allUsedUp={lowPlatforms.some((entry) => entry.remaining === 0)}
      />
    </section>
  );
}
