"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics/plausible";

/**
 * Opens the appropriate next step when a user finishes connecting a social
 * account. Every OAuth callback lands back on /accounts with
 * `?success=true&platform=<id>` (see lib/oauth/callbacks/*), and the manual
 * Telegram/Forem flows set the same params.
 *
 * Shown once per device: after that the checklist on the dashboard is the way
 * back in. Users with an assistant get a prompt to resume their conversation.
 */
export function PostConnectAiPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get("success") === "true";

  const { data: state } = useOnboardingState();
  const { dismissed, dismiss, ready } = useOnboardingDismissal("ai-modal");
  const [open, setOpen] = useState(false);

  // Wait for hydration and the credential query before consuming the callback.
  useEffect(() => {
    if (!justConnected || !ready || !state) return;
    if (!dismissed) setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("success");
    params.delete("platform");
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }, [justConnected, ready, dismissed, state, searchParams, pathname, router]);
  const [copied, setCopied] = useState(false);
  const prompt =
    "List my connected SimplePost accounts, then help me draft my first post. Show me the exact text and destinations and ask for confirmation before publishing or scheduling.";

  const handleClose = () => {
    setOpen(false);
    dismiss();
  };

  if (!state?.hasAiConnection) return <AiConnectModal open={open} onClose={handleClose} />;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your social account is ready</DialogTitle>
          <DialogDescription>
            Return to the assistant you connected and use this prompt to prepare your first post.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border bg-secondary/50 p-4 text-sm select-all">{prompt}</p>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              setCopied(true);
              trackEvent("Activation Prompt Copied");
            } catch {
              setCopied(false);
            }
          }}>
          {copied ? "Copied — return to your conversation" : "Copy starter prompt"}
        </Button>
        <p className="text-xs text-muted-foreground">You can also select and copy the prompt above.</p>
        <Button variant="outline" asChild>
          <Link href="/schedule" onClick={handleClose}>
            Write it in SimplePost
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
