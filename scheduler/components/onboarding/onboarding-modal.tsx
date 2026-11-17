"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { ArrowLeft, ArrowRight } from "lucide-react";

import { AssistantSelector } from "@/components/assistant-selector";
import { focusOnboardingTitle, OnboardingDialog, OnboardingGuide } from "@/components/onboarding/onboarding-guide";
import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBillingStatus } from "@/hooks/use-billing";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { getOnboardingTrialDays } from "@/lib/onboarding/trial-days";

export function OnboardingModal() {
  const { copy } = useUiCopy();
  const { data: billing } = useBillingStatus();
  const { dismissed, dismiss, ready } = useOnboardingDismissal();
  const enabled = billing?.active === true && ready && !dismissed;
  const [assistantView, setAssistantView] = useState<"setup" | "chooser" | "checking">("setup");
  const { data: state, isFetchedAfterMount } = useOnboardingState(enabled, assistantView !== "setup");

  useEffect(() => {
    if (enabled && isFetchedAfterMount && state?.hasPost) dismiss();
  }, [enabled, isFetchedAfterMount, state?.hasPost, dismiss]);

  useEffect(() => {
    if (state?.hasAiConnection) setAssistantView("setup");
  }, [state?.hasAiConnection]);

  if (!enabled || !isFetchedAfterMount || !state || state.hasPost) return null;

  if (assistantView === "chooser" && !state.hasAiConnection) {
    return (
      <OnboardingDialog onClose={() => setAssistantView("setup")}>
        <div className="flex min-h-0 flex-col gap-4 p-6 sm:p-8">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAssistantView("setup")}
            className="-ms-2 self-start text-muted-foreground">
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {copy("Back to setup")}
          </Button>
          <DialogHeader className="text-start">
            <DialogTitle ref={focusOnboardingTitle} tabIndex={-1} className="outline-none">
              {copy("Connect your AI assistant")}
            </DialogTitle>
            <DialogDescription>
              {copy("Choose your assistant and sign in with the same SimplePost account.")}
            </DialogDescription>
          </DialogHeader>
          <AssistantSelector onInstall={() => setAssistantView("checking")} />
        </div>
      </OnboardingDialog>
    );
  }

  return (
    <OnboardingDialog onClose={dismiss}>
      <OnboardingGuide
        trialDays={getOnboardingTrialDays(billing)}
        hasConnectedAccount={state.hasConnectedAccount}
        hasAiConnection={state.hasAiConnection}
        onSkip={dismiss}
        connectAccount={
          <Button asChild size="sm">
            <Link href="/accounts?onboarding=connect">
              {copy("Connect an account")}
              <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          </Button>
        }
        connectAssistant={
          <>
            <Button type="button" size="sm" onClick={() => setAssistantView("chooser")}>
              {copy("Choose an assistant")}
              <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
            </Button>
            {assistantView === "checking" && (
              <p role="status" className="basis-full text-xs text-muted-foreground">
                {copy("Checking for your assistant connection…")}
              </p>
            )}
          </>
        }
        writeManually={
          <Button asChild size="sm" variant="outline">
            <Link href="/schedule">{copy("Write manually")}</Link>
          </Button>
        }
      />
    </OnboardingDialog>
  );
}
