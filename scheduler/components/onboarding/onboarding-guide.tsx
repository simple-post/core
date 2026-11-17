"use client";

import { useState, type ReactNode } from "react";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFirstDraftPrompt } from "@/lib/distribution/starter-prompts";
import { useUiTranslation } from "@/lib/i18n/client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

export function focusOnboardingTitle(title: HTMLHeadingElement | null) {
  title?.focus();
}

export function OnboardingDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        overlayClassName="bg-black/65 backdrop-blur-2xl motion-reduce:animate-none"
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-y-auto rounded-3xl p-0 motion-reduce:animate-none sm:min-h-[min(32rem,calc(100dvh-2rem))] sm:max-w-[42rem]">
        {children}
      </DialogContent>
    </Dialog>
  );
}

function SetupStep({
  number,
  title,
  done = false,
  current,
  action,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  current: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { copy, locale } = useUiCopy();

  return (
    <li
      aria-current={current ? "step" : undefined}
      className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 before:absolute before:start-[1.125rem] before:top-9 before:-bottom-4 before:w-px before:bg-border last:before:hidden sm:gap-x-4 sm:before:-bottom-5">
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full border border-border bg-card font-mono text-xs text-muted-foreground",
          current && "border-primary bg-primary text-primary-foreground",
          done && "border-primary/25 text-primary",
        )}>
        {done ? <Check className="size-4" role="img" aria-label={copy("Complete")} /> : number.toLocaleString(locale)}
      </span>
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className={cn("text-base font-medium", !current && "text-muted-foreground")}>{title}</h3>
        {action}
      </div>
      {children && <div className="col-start-2 min-w-0">{children}</div>}
    </li>
  );
}

export function OnboardingGuide({
  trialDays,
  hasConnectedAccount,
  hasAiConnection,
  connectAccount,
  connectAssistant,
  writeManually,
  onSkip,
}: {
  trialDays: number | null;
  hasConnectedAccount: boolean;
  hasAiConnection: boolean;
  connectAccount: ReactNode;
  connectAssistant?: ReactNode;
  writeManually: ReactNode;
  onSkip: () => void;
}) {
  const { copy } = useUiCopy();
  return (
    <>
      <DialogHeader className="gap-3 px-6 pt-8 pb-7 text-start sm:px-10 sm:pt-10 sm:pb-9">
        <DialogTitle
          ref={focusOnboardingTitle}
          tabIndex={-1}
          className="text-3xl tracking-tight outline-none sm:text-4xl">
          {copy("Welcome to SimplePost")}
        </DialogTitle>
        {trialDays !== null && (
          <DialogDescription className="text-base font-medium text-primary">
            {copy("Your {{days, number}}-day free trial has started.", { days: trialDays })}
          </DialogDescription>
        )}
        {trialDays === null && (
          <DialogDescription className="sr-only">{copy("Write your first post")}</DialogDescription>
        )}
      </DialogHeader>

      <ol className="grid gap-4 px-6 sm:gap-5 sm:px-10">
        <SetupStep
          number={1}
          title={copy("Connect a social account")}
          done={hasConnectedAccount}
          current={!hasConnectedAccount}
          action={!hasConnectedAccount && connectAccount}
        />
        <SetupStep
          number={2}
          title={copy("Connect your AI assistant")}
          done={hasAiConnection}
          current={hasConnectedAccount && !hasAiConnection}
          action={hasConnectedAccount && !hasAiConnection && connectAssistant}
        />
        <SetupStep
          number={3}
          title={copy("Write your first post")}
          current={hasConnectedAccount && hasAiConnection}
          action={hasConnectedAccount && !hasAiConnection && writeManually}>
          {hasConnectedAccount && hasAiConnection && <StarterPrompt manualAction={writeManually} />}
        </SetupStep>
      </ol>

      <div className="mt-auto flex justify-end px-6 pt-5 pb-4 sm:px-10 sm:pt-7 sm:pb-6">
        <Button type="button" size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={onSkip}>
          {copy("Skip setup")}
        </Button>
      </div>
    </>
  );
}

function StarterPrompt({ manualAction }: { manualAction: ReactNode }) {
  const { copy } = useUiCopy();
  const { t } = useUiTranslation();
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const prompt = getFirstDraftPrompt(copy);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary p-3.5">
      <p className="select-text text-sm leading-6">{prompt}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={copyPrompt}>
          {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {status === "copied" ? t("copiedToClipboard") : copy("Copy prompt")}
        </Button>
        {manualAction}
      </div>
      {status === "error" && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy("Could not copy the prompt. Select the text to copy it manually.")}
        </p>
      )}
    </div>
  );
}
