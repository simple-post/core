"use client";

import { useMemo } from "react";

import Link from "next/link";

import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";
import type { BillingTrialStatus } from "@/lib/billing/subscriptions";
import { countAccountsByPlatform, getPlatformName } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Remaining publishes at which a platform starts warning. Exact counts are not
 * worth the user's attention until they are nearly out, so nothing is shown
 * above this.
 */
export const LOW_REMAINING = 3;

/** "X", or "X and Bluesky", or "X, Bluesky and Threads". */
function formatPlatformList(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** Warns about platforms that are nearly out, without putting numbers on screen. */
export function LowAllowanceWarning({
  platforms,
  allUsedUp,
  className,
}: {
  platforms: string[];
  allUsedUp: boolean;
  className?: string;
}) {
  if (platforms.length === 0) return null;

  const names = formatPlatformList(platforms);

  return (
    <div className={cn("rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm", className)}>
      <div className="flex items-center gap-1.5 text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        <p className="font-medium">
          {allUsedUp
            ? `You have used all your free trial posts for ${names}`
            : `Almost all your free trial posts for ${names} are used up`}
        </p>
      </div>
      <p className="mt-1 text-muted-foreground">
        <Link href="/billing/plans" className="font-medium text-primary hover:underline">
          Choose a plan
        </Link>{" "}
        to keep posting there.
      </p>
    </div>
  );
}

export interface TrialPlatformAllowance {
  platform: string;
  label: string;
  used: number;
  limit: number;
  remaining: number;
  /** Publishes this post would add for the platform. */
  requested: number;
}

export interface TrialPostAllowance {
  /** False for paying users and outside the trial, when callers should render nothing. */
  onTrial: boolean;
  /** Platforms this post would push past the cap. Non-empty means it cannot go out. */
  exceeded: TrialPlatformAllowance[];
  /** Platforms close to the cap but still usable. */
  runningLow: TrialPlatformAllowance[];
  maxThreadSegments: number | null;
  threadTooLong: boolean;
  /** True once one more segment would break the thread cap. */
  threadAtLimit: boolean;
  /** True when this post cannot be scheduled or published as configured. */
  blocked: boolean;
}

const EMPTY_ALLOWANCE: TrialPostAllowance = {
  onTrial: false,
  exceeded: [],
  runningLow: [],
  maxThreadSegments: null,
  threadTooLong: false,
  threadAtLimit: false,
  blocked: false,
};

/** The active trial, or null for anyone not currently on one. */
function useActiveTrial(): BillingTrialStatus | null {
  const { data: billing } = useBillingStatus();
  if (billing?.accessType !== "trial") return null;
  const trial = billing.trial ?? null;
  return trial?.status === "active" ? trial : null;
}

/**
 * Trial allowance for the platforms this post targets.
 *
 * Mirrors the server-side projection in `assertCanCreatePost`: the cost is one
 * publish per selected account, and the check is whether current usage plus
 * this post would exceed the cap, not merely whether the cap is already hit.
 * Drafts never consume allowance, so pass `isDraft` to opt out of blocking.
 */
export function useTrialPostAllowance({
  platforms,
  threadSegments = 1,
  isDraft = false,
}: {
  /** One entry per selected account; duplicates are meaningful. */
  platforms: string[];
  threadSegments?: number;
  isDraft?: boolean;
}): TrialPostAllowance {
  const trial = useActiveTrial();

  return useMemo(() => {
    if (!trial || isDraft) {
      return EMPTY_ALLOWANCE;
    }

    const exceeded: TrialPlatformAllowance[] = [];
    const runningLow: TrialPlatformAllowance[] = [];
    const requestedByPlatform = countAccountsByPlatform(platforms.map((platform) => ({ platform })));

    for (const [platform, requested] of Object.entries(requestedByPlatform)) {
      const used = trial.platformUsage[platform] ?? 0;
      const entry: TrialPlatformAllowance = {
        platform,
        label: getPlatformName(platform),
        used,
        limit: trial.postsPerPlatform,
        remaining: Math.max(0, trial.postsPerPlatform - used),
        requested,
      };

      if (used + requested > trial.postsPerPlatform) {
        exceeded.push(entry);
      } else if (entry.remaining < LOW_REMAINING) {
        runningLow.push(entry);
      }
    }

    return {
      onTrial: true,
      exceeded,
      runningLow,
      maxThreadSegments: trial.maxThreadSegments,
      threadTooLong: threadSegments > trial.maxThreadSegments,
      threadAtLimit: threadSegments >= trial.maxThreadSegments,
      blocked: exceeded.length > 0 || threadSegments > trial.maxThreadSegments,
    };
  }, [trial, platforms, threadSegments, isDraft]);
}

/**
 * Feedback about the post currently being composed. Only speaks up when the
 * selected accounts are at or near their limit; exact counts stay off screen.
 */
export function TrialLimitNotice({ allowance }: { allowance: TrialPostAllowance }) {
  if (!allowance.onTrial) return null;

  const { exceeded, runningLow, threadTooLong, maxThreadSegments } = allowance;
  if (exceeded.length === 0 && runningLow.length === 0 && !threadTooLong) {
    return null;
  }

  if (threadTooLong) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
        <div className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          <p className="font-medium">Thread is too long</p>
        </div>
        <p className="mt-1 text-muted-foreground">
          The free trial allows up to {maxThreadSegments} posts in a thread. Shorten it or{" "}
          <Link href="/billing/plans" className="font-medium text-primary hover:underline">
            choose a plan
          </Link>
          .
        </p>
      </div>
    );
  }

  const platforms = exceeded.length > 0 ? exceeded : runningLow;

  return (
    <LowAllowanceWarning
      platforms={platforms.map((entry) => entry.label)}
      allUsedUp={platforms.some((entry) => entry.remaining === 0)}
    />
  );
}

/**
 * Ambient trial status above the compose form: how long is left, plus a nudge
 * once a platform is nearly out. Usage is tracked per platform on the server,
 * but the numbers are only worth surfacing when they start to bite.
 */
export function TrialScheduleNotice() {
  const trial = useActiveTrial();

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

  if (!trial) return null;

  const anyExhausted = lowPlatforms.some((entry) => entry.remaining === 0);

  return (
    <div className="mb-6 space-y-3">
      <div className="rounded-xl border border-primary/25 bg-primary/10 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Free trial · {trial.daysRemaining} {trial.daysRemaining === 1 ? "day" : "days"} left
          </div>
          <Button asChild size="sm" variant={lowPlatforms.length > 0 ? "default" : "outline"} className="shrink-0">
            <Link href="/billing/plans">{lowPlatforms.length > 0 ? "Upgrade to keep posting" : "Upgrade"}</Link>
          </Button>
        </div>
      </div>

      <LowAllowanceWarning platforms={lowPlatforms.map((entry) => entry.label)} allUsedUp={anyExhausted} />
    </div>
  );
}
