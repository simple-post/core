"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";

export interface RepostSettings {
  enabled: boolean;
  delayHours: number;
}

interface RepostSettingsResponse {
  settings: RepostSettings;
}

async function fetchRepostSettings(): Promise<RepostSettings> {
  const response = await fetch("/api/v1/repost-settings");
  if (!response.ok) {
    throw new Error("Failed to fetch repost settings");
  }
  const data = (await response.json()) as RepostSettingsResponse;
  return data.settings;
}

async function updateRepostSettings(settings: RepostSettings): Promise<RepostSettings> {
  const response = await fetch("/api/v1/repost-settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update repost settings");
  }

  const data = (await response.json()) as RepostSettingsResponse;
  return data.settings;
}

export function useRepostSettings() {
  return useQuery({
    queryKey: queryKeys.repostSettings,
    queryFn: fetchRepostSettings,
  });
}

export function useUpdateRepostSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateRepostSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.repostSettings, settings);
    },
  });
}
