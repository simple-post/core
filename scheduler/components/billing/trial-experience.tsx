"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Bot, CalendarCheck2, Check, Circle, Link2, Rocket, Sparkles } from "lucide-react";

import { useBillingStatus } from "@/components/billing/billing-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccounts } from "@/hooks/use-accounts";
import { useSession } from "@/lib/auth/auth-client";
import { getPlatformById } from "@/lib/config";
import { cn } from "@/lib/utils";

const ONBOARDING_STORAGE_PREFIX = "simplepost:trial-onboarding:v1";

function storageKey(userId: string, step: "welcome" | "ai" | "ai-setup") {
  return `${ONBOARDING_STORAGE_PREFIX}:${userId}:${step}`;
}

function platformName(platform: string) {
  if (platform === "twitter") return "X";
  return getPlatformById(platform)?.name ?? `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}

export function TrialOnboardingDialogs() {
  const billingContext = useBillingStatus();
  const { data: session } = useSession();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const pathname = usePathname();
  const router = useRouter();
  const [dialog, setDialog] = useState<"welcome" | "ai" | null>(null);
  const userId = session?.user?.id;
  const isTrial = billingContext?.billing.accessType === "trial";

  useEffect(() => {
    if (!isTrial || !userId || accountsLoading || pathname.startsWith("/billing") || pathname === "/subscribe") {
      setDialog(null);
      return;
    }

    const welcomeSeen = window.localStorage.getItem(storageKey(userId, "welcome")) === "seen";
    const aiSeen = window.localStorage.getItem(storageKey(userId, "ai")) === "seen";

    if (!welcomeSeen) {
      setDialog("welcome");
    } else if (accounts.length > 0 && !aiSeen) {
      setDialog("ai");
    }
  }, [accounts.length, accountsLoading, isTrial, pathname, userId]);

  useEffect(() => {
    if (
      isTrial &&
      !accountsLoading &&
      billingContext &&
      accounts.length !== billingContext.billing.usage.connectedAccounts
    ) {
      void billingContext.refreshBilling();
    }
  }, [accounts.length, accountsLoading, billingContext, isTrial]);

  const complete = (step: "welcome" | "ai") => {
    if (userId) window.localStorage.setItem(storageKey(userId, step), "seen");
    setDialog(null);
  };

  if (!isTrial || !userId) return null;

  return (
    <>
      <Dialog
        open={dialog === "welcome"}
        onOpenChange={(open) => {
          if (!open) complete("welcome");
        }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <Rocket className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl tracking-[-0.025em]">Your 7-day runway is ready</DialogTitle>
            <DialogDescription className="leading-6">
              All SimplePost features are unlocked. No card required. Start with one social account, then let your AI
              assistant schedule the first post.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {[
              ["Connect a social account", "Give SimplePost somewhere to publish."],
              ["Connect ChatGPT, Claude, or another AI", "Schedule by describing what you want in a conversation."],
              ["Send or schedule your first post", "Use the web app or your connected assistant."],
            ].map(([title, description], index) => (
              <div key={title} className="flex gap-3 rounded-xl border border-border bg-secondary/50 p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              className="w-full gap-2"
              onClick={() => {
                complete("welcome");
                router.push("/accounts?onboarding=connect");
              }}>
              <Link2 className="h-4 w-4" />
              Connect my first account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "ai"}
        onOpenChange={(open) => {
          if (!open) complete("ai");
        }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl tracking-[-0.025em]">Now put your AI in the loop</DialogTitle>
            <DialogDescription className="leading-6">
              Your social account is connected. Add SimplePost to ChatGPT, Claude, or your preferred MCP client and try
              “Schedule this for LinkedIn tomorrow at 9.”
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-primary/25 bg-primary/10 p-4">
            <div className="flex items-start gap-3">
              <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Why start here?</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The AI can inspect your connected accounts, validate drafts, and schedule posts without copying
                  content between tools.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-stretch">
            <Button
              variant="outline"
              className="sm:flex-1"
              onClick={() => {
                complete("ai");
                router.push("/schedule");
              }}>
              Create manually
            </Button>
            <Button
              className="gap-2 sm:flex-1"
              onClick={() => {
                complete("ai");
                window.localStorage.setItem(storageKey(userId, "ai-setup"), "seen");
                router.push("/integrations?onboarding=ai");
              }}>
              <Sparkles className="h-4 w-4" />
              Connect an AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TrialRunway() {
  const billingContext = useBillingStatus();
  const { data: session } = useSession();
  const [aiStepDone, setAiStepDone] = useState(false);
  const billing = billingContext?.billing;
  const trial = billing?.freeTrial;
  const userId = session?.user?.id;

  useEffect(() => {
    setAiStepDone(Boolean(userId && window.localStorage.getItem(storageKey(userId, "ai-setup")) === "seen"));
  }, [userId]);

  if (billing?.accessType !== "trial" || !trial) return null;

  const elapsedDays = Math.min(7, Math.max(0, 7 - trial.daysRemaining));
  const steps = [
    {
      done: billing.usage.connectedAccounts > 0,
      href: "/accounts?onboarding=connect",
      icon: Link2,
      label: "Connect account",
    },
    {
      done: aiStepDone,
      href: "/integrations?onboarding=ai",
      icon: Bot,
      label: "Set up AI",
    },
    {
      done: billing.usage.postsThisPeriod > 0,
      href: "/schedule",
      icon: CalendarCheck2,
      label: "Schedule a post",
    },
  ];

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-primary/25 bg-card animate-reveal">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.25fr_1fr] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">Free trial</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {trial.daysRemaining} {trial.daysRemaining === 1 ? "day" : "days"} left
            </span>
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-[-0.025em] text-foreground">
            Take SimplePost through a real workflow
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
            All features are unlocked. Schedule up to {trial.postsPerPlatform} posts per platform during your trial.
          </p>

          <div className="mt-4 grid grid-cols-7 gap-1" aria-label={`${trial.daysRemaining} days remaining in trial`}>
            {Array.from({ length: 7 }, (_, index) => (
              <span
                key={index}
                className={cn("h-1.5 rounded-full", index < elapsedDays ? "bg-primary/35" : "bg-primary")}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <Link
                key={step.label}
                href={step.href}
                className="group flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 transition-colors hover:border-primary/35 hover:bg-secondary/70">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg border",
                    step.done
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground",
                  )}>
                  {step.done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <span className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through")}>
                  {step.label}
                </span>
                {step.done ? null : <Circle className="ml-auto h-2 w-2 fill-primary text-primary" />}
              </Link>
            );
          })}
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link href="/billing/plans">See upgrade options</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function TrialScheduleNotice() {
  const billingContext = useBillingStatus();
  const billing = billingContext?.billing;
  const trial = billing?.freeTrial;

  const platformUsage = useMemo(
    () =>
      Object.entries(billing?.usage.postsByPlatform ?? {}).sort(([platformA], [platformB]) =>
        platformName(platformA).localeCompare(platformName(platformB)),
      ),
    [billing?.usage.postsByPlatform],
  );

  if (billing?.accessType !== "trial" || !trial) return null;

  const hasReachedLimit = platformUsage.some(([, count]) => count >= trial.postsPerPlatform);

  return (
    <div
      className={cn(
        "mb-6 rounded-xl border p-4",
        hasReachedLimit ? "border-amber-500/35 bg-amber-500/10" : "border-primary/25 bg-primary/10",
      )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Free trial · {trial.daysRemaining} {trial.daysRemaining === 1 ? "day" : "days"} left
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            You can schedule {trial.postsPerPlatform} posts per platform. Threads may contain up to{" "}
            {trial.maxThreadPosts} posts and count as one scheduled post.
          </p>
        </div>
        <Button asChild size="sm" variant={hasReachedLimit ? "default" : "outline"} className="shrink-0">
          <Link href="/billing/plans">{hasReachedLimit ? "Upgrade to keep posting" : "Upgrade"}</Link>
        </Button>
      </div>
      {platformUsage.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {platformUsage.map(([platform, count]) => (
            <span
              key={platform}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                count >= trial.postsPerPlatform
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-background/60 text-muted-foreground",
              )}>
              {platformName(platform)} {count}/{trial.postsPerPlatform}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
