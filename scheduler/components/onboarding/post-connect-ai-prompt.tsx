"use client";

import { useEffect, useState } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { useOnboardingDismissal, useOnboardingState } from "@/components/onboarding/use-onboarding";

/**
 * Opens the AI/MCP pitch the moment a user finishes connecting a social
 * account. Every OAuth callback lands back on /accounts with
 * `?success=true&platform=<id>` (see lib/oauth/callbacks/*), and the manual
 * Telegram/Forem flows set the same params.
 *
 * Shown once per device: after that the checklist on the dashboard is the way
 * back in. Users who already wired up an assistant never see it.
 */
export function PostConnectAiPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get("success") === "true";

  const { data: state } = useOnboardingState();
  const { dismissed, dismiss, ready } = useOnboardingDismissal("ai-modal");
  const [open, setOpen] = useState(false);

  // Drop the one-shot params straight away so a refresh or a back-navigation
  // does not reopen the modal.
  useEffect(() => {
    if (justConnected) {
      router.replace(pathname, { scroll: false });
    }
  }, [justConnected, pathname, router]);

  useEffect(() => {
    if (justConnected && ready && !dismissed && state && !state.hasAiConnection) {
      setOpen(true);
    }
  }, [justConnected, ready, dismissed, state]);

  const handleClose = () => {
    setOpen(false);
    dismiss();
  };

  return <AiConnectModal open={open} onClose={handleClose} />;
}
