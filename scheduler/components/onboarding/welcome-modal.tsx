"use client";

import { usePathname, useRouter } from "next/navigation";

import { Bot, Link2, PenLine, Rocket } from "lucide-react";

import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBillingStatus } from "@/hooks/use-billing";

const STEPS = [
  {
    Icon: Link2,
    title: "Connect a social account",
    description: "Give SimplePost somewhere to publish.",
  },
  {
    Icon: Bot,
    title: "Install SimplePost in your AI",
    description: "One click in ChatGPT, then schedule from the conversation.",
  },
  {
    Icon: PenLine,
    title: "Send or schedule your first post",
    description: "From the web app, or straight from your assistant.",
  },
];

/**
 * First thing a brand-new trial user sees. It exists to name the three steps
 * and hand off directly into the first one. The dashboard checklist is the
 * fallback for anyone who dismisses it or comes back later.
 *
 * Suppressed once the user has done anything at all, so returning users and
 * anyone who signed up through the MCP server never get an empty pep talk.
 */
export function WelcomeModal() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: billing } = useBillingStatus();
  const { data: state } = useOnboardingState();
  const { dismissed, dismiss, ready } = useOnboardingDismissal("welcome");

  const onTrial = billing?.accessType === "trial" && billing.trial?.status === "active";
  const untouched = state ? !state.hasConnectedAccount && !state.hasAiConnection && !state.hasPost : false;
  // Billing pages are a deliberate destination; do not interrupt them there.
  const onBillingPath = pathname.startsWith("/billing") || pathname === "/subscribe";
  const open = Boolean(ready && !dismissed && onTrial && untouched && !onBillingPath);

  const trialDays = billing?.trial?.daysRemaining ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl tracking-[-0.025em]">Your {trialDays}-day free trial is ready</DialogTitle>
          <DialogDescription className="leading-6">
            Every feature is unlocked and no card is required. Start with one social account, then let your AI assistant
            schedule the first post.
          </DialogDescription>
        </DialogHeader>

        <ol className="grid gap-2">
          {STEPS.map(({ Icon, title, description }, index) => (
            <li key={title} className="flex gap-3 rounded-xl border border-border bg-secondary/50 p-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {title}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button
            className="w-full gap-2"
            onClick={() => {
              dismiss();
              router.push("/accounts?onboarding=connect");
            }}>
            <Link2 className="h-4 w-4" />
            Connect my first account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
