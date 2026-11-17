"use client";

import { useQuery } from "@tanstack/react-query";

import { useStoredOnboardingDismissal } from "@/components/onboarding/use-stored-onboarding-dismissal";
import { useSession } from "@/lib/auth/auth-client";
import type { OnboardingState } from "@/lib/onboarding/state";
import { queryKeys } from "@/lib/query-client";

async function fetchOnboardingState(): Promise<OnboardingState> {
  const response = await fetch("/api/v1/onboarding", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch onboarding state");
  }
  return (await response.json()) as OnboardingState;
}

export function useOnboardingState(enabled: boolean, checkingAssistant: boolean) {
  return useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    // An assistant can connect or save a draft in another app.
    refetchInterval: (query) => (query.state.data?.hasPost === false ? (checkingAssistant ? 2000 : 4000) : false),
    refetchIntervalInBackground: checkingAssistant,
  });
}

/**
 * Store browser-level dismissal for the signed-in user, including after the
 * modal has seen a saved post. Wait for storage before showing the modal.
 */
export function useOnboardingDismissal() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  // Keep the original key for users who dismissed the checklist.
  return useStoredOnboardingDismissal(userId ? `simplepost:onboarding:dismissed:v1:checklist:${userId}` : null);
}
