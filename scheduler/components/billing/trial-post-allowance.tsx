"use client";

import { useMemo } from "react";

import Link from "next/link";

import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBillingStatus } from "@/hooks/use-billing";
import type { BillingTrialStatus } from "@/lib/billing/subscriptions";
import { countAccountsByPlatform, getPlatformName } from "@/lib/config";
import { cn } from "@/lib/utils";

/** How close to the cap a platform gets before the compose form warns about it. */
const WARN_WITHIN = 3;

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
  /** False for paying users and outside the trial — callers should render nothing. */
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
 * this post would exceed the cap — not merely whether the cap is already hit.
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
      } else if (entry.remaining <= WARN_WITHIN) {
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

function formatPlatformList(entries: TrialPlatformAllowance[]): string {
  const labels = entries.map((entry) => entry.label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Feedback about the post currently being composed. Ambient trial status lives
 * in {@link TrialScheduleNotice} instead; this only speaks up when the selected
 * accounts are at or near their limit.
 */
export function TrialLimitNotice({ allowance }: { allowance: TrialPostAllowance }) {
  if (!allowance.onTrial) return null;

  const { exceeded, runningLow, threadTooLong, maxThreadSegments } = allowance;
  if (exceeded.length === 0 && runningLow.length === 0 && !threadTooLong) {
    return null;
  }

  if (allowance.blocked) {
    return (
      <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
        <div className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          <p className="font-medium">Free trial limit reached</p>
        </div>
        {exceeded.length > 0 ? (
          <p className="text-muted-foreground">
            This post would take {formatPlatformList(exceeded)} past the {exceeded[0].limit} publishes the trial
            includes per platform. Remove {exceeded.length === 1 ? "that account" : "those accounts"} or choose a plan.
          </p>
        ) : null}
        {threadTooLong ? (
          <p className="text-muted-foreground">
            The free trial allows up to {maxThreadSegments} posts in a thread. Shorten the thread or upgrade.
          </p>
        ) : null}
        <Link href="/billing/plans" className="inline-block pt-1 font-medium text-primary hover:underline">
          Choose a plan
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
      <div className="flex items-center gap-1.5 text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <p className="font-medium">Free trial</p>
      </div>
      <p className="mt-1 text-muted-foreground">
        {runningLow
          .map(
            (entry) => `${entry.remaining} ${entry.remaining === 1 ? "publish" : "publishes"} left for ${entry.label}`,
          )
          .join(" · ")}
        .{" "}
        <Link href="/billing/plans" className="font-medium text-primary hover:underline">
          Choose a plan
        </Link>{" "}
        to lift the limit.
      </p>
    </div>
  );
}

/**
 * Ambient trial status above the compose form: time left and where the
 * allowance has gone, visible before the user selects anything.
 */
export function TrialScheduleNotice() {
  const trial = useActiveTrial();

  const platformUsage = useMemo(
    () =>
      Object.entries(trial?.platformUsage ?? {})
        .filter(([, used]) => used > 0)
        .sort(([a], [b]) => getPlatformName(a).localeCompare(getPlatformName(b))),
    [trial],
  );

  if (!trial) return null;

  const anyExhausted = platformUsage.some(([, used]) => used >= trial.postsPerPlatform);

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border p-4",
        anyExhausted ? "border-destructive/30 bg-destructive/10" : "border-primary/25 bg-primary/10",
      )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Free trial · {trial.daysRemaining} {trial.daysRemaining === 1 ? "day" : "days"} left
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {trial.postsPerPlatform} publishes per platform. A thread counts as one publish and may contain up to{" "}
            {trial.maxThreadSegments} posts.
          </p>
        </div>
        <Button asChild size="sm" variant={anyExhausted ? "default" : "outline"} className="shrink-0">
          <Link href="/billing/plans">{anyExhausted ? "Upgrade to keep posting" : "Upgrade"}</Link>
        </Button>
      </div>

      {platformUsage.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {platformUsage.map(([platform, used]) => (
            <span
              key={platform}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                used >= trial.postsPerPlatform
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-background/60 text-muted-foreground",
              )}>
              {getPlatformName(platform)} {used}/{trial.postsPerPlatform}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
