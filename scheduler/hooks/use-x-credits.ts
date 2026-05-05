"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";

async function fetchXCredits(): Promise<number> {
  const response = await fetch("/api/v1/credits");
  if (!response.ok) throw new Error("Failed to fetch X credits");
  const data = (await response.json()) as { xPostingCredits: number };
  return data.xPostingCredits;
}

export function useXCredits() {
  return useQuery({
    queryKey: queryKeys.xCredits,
    queryFn: fetchXCredits,
  });
}
