"use client";

import { useMemo } from "react";

import Link from "next/link";

import { Sparkles } from "lucide-react";

import { LowAllowanceWarning, LOW_REMAINING } from "@/components/billing/trial-post-allowance";
import { HelpLink } from "@/components/help-link";
import { Button } from "@/components/ui/button";
import { UiCopy } from "@/components/ui-copy";
import { useBillingStatus } from "@/hooks/use-billing";
import { getPlatformName } from "@/lib/config";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

/**
 * Free-trial status on the dashboard: time left, the upgrade path, and a
 * warning once a platform is nearly used up. Per-platform counts are tracked
 * server-side but stay off screen until they start to matter.
 *
 * Renders nothing for paying users and for the expired trial, which the
 * blocking dialog in SubscriptionGate handles instead.
 */
export function TrialBanner() {
  const { copy, locale } = useUiCopy();
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
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [trial, locale]);

  if (!trial || trial.status !== "active") {
    return null;
  }

  return (
    <section className="mb-6 space-y-3 animate-reveal">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-background text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold tracking-[-0.025em] text-foreground">
                {trial.daysRemaining <= 0
                  ? copy("You are on the free trial. Ends today.")
                  : copy("You are on the free trial. {{count, number}} days left.", { count: trial.daysRemaining })}
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              <UiCopy
                source="Ends on <part1></part1>. Every feature is unlocked, with {{count, number}} posts per platform. No credit card needed. <part2>Trial details</part2>"
                values={{ count: trial.postsPerPlatform }}
                components={{
                  part1: (
                    <time dateTime={trial.expiresAt}>
                      {new Date(trial.expiresAt).toLocaleDateString(locale, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  ),
                  part2: <HelpLink path="/billing#free-trial" className="align-baseline" />,
                }}
              />
            </p>
          </div>

          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/billing/plans">{copy("Choose a plan")}</Link>
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
