"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { queryKeys } from "@/lib/query-client";
import { ApiResponseError } from "@/lib/utils/api-response-error";

export interface RepostSettings {
  enabled: boolean;
  delayHours: number;
}

interface RepostSettingsResponse {
  settings: RepostSettings;
}

async function fetchRepostSettings(copy: SourceCopy): Promise<RepostSettings> {
  const response = await fetch("/api/v1/repost-settings");
  if (!response.ok) {
    throw new ApiResponseError(
      await response.json().catch(() => null),
      copy("Failed to fetch repost settings"),
      response.status,
    );
  }
  const data = (await response.json()) as RepostSettingsResponse;
  return data.settings;
}

async function updateRepostSettings(settings: RepostSettings, copy: SourceCopy): Promise<RepostSettings> {
  const response = await fetch("/api/v1/repost-settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || copy("Failed to update repost settings"));
  }

  const data = (await response.json()) as RepostSettingsResponse;
  return data.settings;
}

export function useRepostSettings() {
  const { copy } = useUiCopy();
  return useQuery({
    queryKey: queryKeys.repostSettings,
    queryFn: () => fetchRepostSettings(copy),
  });
}

export function useUpdateRepostSettings() {
  const { copy } = useUiCopy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: RepostSettings) => updateRepostSettings(settings, copy),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.repostSettings, settings);
    },
  });
}
