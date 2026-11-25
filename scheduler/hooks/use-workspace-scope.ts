"use client";

import { useSearchParams } from "next/navigation";

import { useFeatures } from "@/hooks/use-features";

export function useWorkspaceScope() {
  const requested = useSearchParams()?.get("workspace");
  const { hasFeature, isPending } = useFeatures();
  const enabled = hasFeature("TEAM_WORKSPACES");
  return { requested, enabled, id: enabled ? requested : null, isPending };
}
