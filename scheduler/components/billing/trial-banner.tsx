"use client";

import Link from "next/link";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";
import type { BillingTrialStatus } from "@/lib/billing/subscriptions";
import { getPlatformById } from "@/lib/config";

function formatDaysRemaining(days: number): string {
  if (days <= 0) return "Ends today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** The platforms closest to their allowance, so the banner warns before the wall. */
function getTightestPlatforms(trial: BillingTrialStatus, limit = 3) {
  return Object.entries(trial.platformUsage)
    .filter(([, used]) => used > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([platform, used]) => ({
      platform,
      label: getPlatformById(platform)?.name ?? platform,
      used,
      exhausted: used >= trial.postsPerPlatform,
    }));
}

/**
 * Free-trial status on the dashboard: time left, what has been used, and the
 * upgrade path. Renders nothing for paying users and for the expired trial,
 * which is handled by the blocking dialog in SubscriptionGate instead.
 */
export function TrialBanner() {
  const { data: billing } = useBillingStatus();
  const trial = billing?.trial ?? null;

  if (billing?.accessType !== "trial" || !trial || trial.status !== "active") {
    return null;
  }

  const platforms = getTightestPlatforms(trial);

  return (
    <section className="mb-6 rounded-2xl border border-primary/30 bg-primary/10 p-4 sm:p-5 animate-reveal">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-background text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <h2 className="text-base font-semibold tracking-[-0.025em] text-foreground">
              You are on the free trial — {formatDaysRemaining(trial.daysRemaining)}
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every feature is unlocked, with {trial.postsPerPlatform} posts per platform. No credit card needed.
          </p>
          {platforms.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {platforms.map((entry) => (
                <li
                  key={entry.platform}
                  className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
                    entry.exhausted ? "text-destructive" : "text-muted-foreground"
                  }`}>
                  {entry.label} {entry.used}/{trial.postsPerPlatform}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Button asChild className="shrink-0">
          <Link href="/billing/plans">Choose a plan</Link>
        </Button>
      </div>
    </section>
  );
}
