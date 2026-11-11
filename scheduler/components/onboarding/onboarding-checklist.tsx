"use client";

import { useState } from "react";

import Link from "next/link";

import { Check, X } from "lucide-react";

import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

interface ChecklistStep {
  id: string;
  title: string;
  done: boolean;
  action: { label: string; href: string } | { label: string; onClick: () => void };
}

function StepRow({ step, index }: { step: ChecklistStep; index: number }) {
  const { copy, locale } = useUiCopy();
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
          step.done ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground",
        )}>
        {step.done ? (
          <Check className="h-3.5 w-3.5" role="img" aria-label={copy("Complete")} />
        ) : (
          (index + 1).toLocaleString(locale)
        )}
      </span>
      <span className={cn("min-w-0 flex-1 text-sm", step.done && "text-muted-foreground")}>{step.title}</span>
      {step.done ? null : "href" in step.action ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={step.action.href}>{step.action.label}</Link>
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={step.action.onClick}>
          {step.action.label}
        </Button>
      )}
    </li>
  );
}

export function OnboardingChecklist() {
  const { copy } = useUiCopy();
  const readOnly = useWorkspaceReadOnly();
  const { data: state } = useOnboardingState();
  const { dismissed, dismiss, ready } = useOnboardingDismissal("checklist");
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const complete = state?.hasConnectedAccount && state.hasAiConnection && state.hasPost;
  if (readOnly || !state || complete || !ready || dismissed) return null;

  const steps: ChecklistStep[] = [
    {
      id: "account",
      title: copy("Connect a social account"),
      done: state.hasConnectedAccount,
      action: { label: copy("Connect"), href: "/accounts?onboarding=connect" },
    },
    {
      id: "post",
      title: copy("Schedule your first post"),
      done: state.hasPost,
      action: { label: copy("Compose"), href: "/schedule" },
    },
    {
      id: "ai",
      title: copy("Install SimplePost in your AI"),
      done: state.hasAiConnection,
      action: { label: copy("Install"), onClick: () => setAiModalOpen(true) },
    },
  ];

  return (
    <>
      <section
        aria-label={copy("Getting started")}
        className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{copy("Getting started")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={dismiss}
            aria-label={copy("Dismiss getting started")}
            className="h-7 w-7 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ol className="divide-y divide-border">
          {steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index} />
          ))}
        </ol>
      </section>
      <AiConnectModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
    </>
  );
}
