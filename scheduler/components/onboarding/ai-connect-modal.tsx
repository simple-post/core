"use client";

import { useRouter } from "next/navigation";

import { Check, Loader2, MessageSquareQuote } from "lucide-react";

import { AssistantSelector } from "@/components/assistant-selector";
import { useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The pitch for SimplePost's differentiator, shown at the one moment it lands:
 * right after a user connects their first social account, when they are about
 * to go looking for a compose box.
 *
 * The assistant is set up in another app, so while this is open we poll for the
 * access token that approving SimplePost creates. That turns "did it work?"
 * into something the user can see, and gives the modal a real completion state
 * instead of a button that just reopens the same instructions elsewhere.
 */
export function AiConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data: state } = useOnboardingState({ watch: open });
  const connected = state?.hasAiConnection ?? false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-7 sm:max-w-3xl sm:p-9">
        <DialogHeader className="mb-8">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <MessageSquareQuote className="h-4 w-4" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              The fastest way to post
            </span>
          </div>
          <DialogTitle className="text-2xl tracking-[-0.025em]">Now let your AI do the posting</DialogTitle>
          <DialogDescription className="mt-2.5 text-base leading-7">
            Add the SimplePost remote MCP URL to ChatGPT or Claude manually, then just ask it to schedule.
          </DialogDescription>
        </DialogHeader>

        <AssistantSelector />

        <div className="mt-9 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          {connected ? (
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Check className="h-4 w-4" />
              Assistant connected
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Waiting for your assistant to connect
            </p>
          )}

          {connected ? (
            <Button
              onClick={() => {
                onClose();
                router.push("/schedule");
              }}>
              Schedule your first post
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>
              Maybe later
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
