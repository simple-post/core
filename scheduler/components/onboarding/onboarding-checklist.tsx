"use client";

import { useState, type ComponentType } from "react";

import Link from "next/link";

import { Check, PenLine, Users, X } from "lucide-react";

import { ClaudeIcon, OpenAIIcon } from "@/components/brand-icons";
import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  Icon: ComponentType<{ className?: string }>;
  action: { label: string; href: string } | { label: string; onClick: () => void };
}

function StepRow({ step, index }: { step: ChecklistStep; index: number }) {
  const { Icon } = step;

  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-medium",
          step.done
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border bg-background text-muted-foreground",
        )}>
        {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", step.done ? "text-primary" : "text-muted-foreground")} />
          <p
            className={cn("text-sm font-medium", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
            {step.title}
          </p>
        </div>
        {step.done ? null : <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>}
      </div>

      {step.done ? null : (
        <Button asChild={"href" in step.action} size="sm" variant="outline" className="shrink-0">
          {"href" in step.action ? (
            <Link href={step.action.href}>{step.action.label}</Link>
          ) : (
            <button type="button" onClick={step.action.onClick}>
              {step.action.label}
            </button>
          )}
        </Button>
      )}
    </li>
  );
}

/**
 * First-run guidance on the dashboard. The middle step is the AI integration
 * rather than an afterthought, because that is what makes SimplePost different
 * from every other scheduler. Connecting an assistant is deliberately placed
 * before writing a first post.
 *
 * Disappears on its own once all three steps are done, so it never needs
 * dismissing in the normal case.
 */
export function OnboardingChecklist() {
  const { data: state } = useOnboardingState();
  const { dismissed, dismiss, ready } = useOnboardingDismissal("checklist");
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const complete = state ? state.hasConnectedAccount && state.hasAiConnection && state.hasPost : false;
  if (!state || complete || !ready || dismissed) {
    return null;
  }

  const steps: ChecklistStep[] = [
    {
      id: "account",
      title: "Connect a social account",
      description: "Link X, LinkedIn, Bluesky, Instagram, or any of the 10 supported platforms.",
      done: state.hasConnectedAccount,
      Icon: Users,
      action: { label: "Connect", href: "/accounts" },
    },
    {
      id: "ai",
      title: "Install SimplePost in your AI",
      description: "In ChatGPT, install the SimplePost plugin in one click. Claude and other MCP clients work too.",
      done: state.hasAiConnection,
      Icon: OpenAIIcon,
      action: { label: "Install", onClick: () => setAiModalOpen(true) },
    },
    {
      id: "post",
      title: "Schedule your first post",
      description: "Write it here, or just ask your assistant to do it for you.",
      done: state.hasPost,
      Icon: PenLine,
      action: { label: "Compose", href: "/schedule" },
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;

  return (
    <>
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5 animate-reveal">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">
                Getting started · {doneCount} of {steps.length}
              </span>
            </div>
            <h2 className="text-base font-semibold tracking-[-0.025em] text-foreground">
              Three steps to posting from <span className="text-primary">your AI assistant</span>
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={dismiss}
            aria-label="Dismiss getting started"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ul className="grid gap-4">
          {steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index} />
          ))}
        </ul>

        {state.hasAiConnection ? null : (
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <OpenAIIcon className="h-3.5 w-3.5" />
            <ClaudeIcon className="h-3.5 w-3.5" />
            <span>Works with ChatGPT, Claude, Claude Code, and any MCP client.</span>
          </div>
        )}
      </section>

      <AiConnectModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
    </>
  );
}
