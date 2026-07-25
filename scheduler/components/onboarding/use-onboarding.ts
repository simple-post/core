"use client";

import { useCallback, useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/lib/auth/auth-client";
import type { OnboardingState } from "@/lib/onboarding/state";
import { queryKeys } from "@/lib/query-client";

const DISMISSAL_STORAGE_PREFIX = "simplepost:onboarding:dismissed:v1";

export type OnboardingDismissal = "checklist" | "ai-modal" | "welcome";

async function fetchOnboardingState(): Promise<OnboardingState> {
  const response = await fetch("/api/v1/onboarding", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch onboarding state");
  }
  return (await response.json()) as OnboardingState;
}

/**
 * Onboarding progress, derived from real data on the server.
 *
 * Pass `watch` while a surface is waiting for the user to finish something in
 * another app: connecting an assistant happens in ChatGPT or Claude, so the
 * only way to notice it is to keep asking.
 */
export function useOnboardingState({ watch = false }: { watch?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    staleTime: watch ? 0 : 30 * 1000,
    refetchInterval: watch ? 4000 : false,
  });
}

/**
 * Per-user, per-surface "don't show me this again" flags.
 *
 * Kept in localStorage rather than the database: dismissing a hint is a
 * device-level preference, and the underlying progress is always re-derivable
 * from {@link useOnboardingState}, so losing a flag costs nothing.
 * `ready` stays false until the stored value has been read, which keeps a
 * dismissed panel from flashing on mount.
 */
export function useOnboardingDismissal(surface: OnboardingDismissal) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const storageKey = userId ? `${DISMISSAL_STORAGE_PREFIX}:${surface}:${userId}` : null;
  const [dismissed, setDismissed] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setDismissed(true);
      setReady(false);
      return;
    }

    setDismissed(window.localStorage.getItem(storageKey) === "true");
    setReady(true);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (storageKey) {
      window.localStorage.setItem(storageKey, "true");
    }
  }, [storageKey]);

  return { dismissed, dismiss, ready };
}
