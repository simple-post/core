"use client";
import { useQuery } from "@tanstack/react-query";

import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { queryKeys } from "@/lib/query-client";
import type { TikTokCreatorInfo } from "@/lib/tiktok/creator-info";

async function fetchCreatorInfo(accountId: string, copy: SourceCopy): Promise<TikTokCreatorInfo> {
  const response = await fetch(`/api/v1/accounts/${accountId}/tiktok/creator-info`);
  const data = (await response.json().catch(() => ({}))) as { creatorInfo?: TikTokCreatorInfo; error?: string };
  if (!response.ok || !data.creatorInfo) {
    throw new Error(data.error || copy("Failed to fetch TikTok creator info"));
  }
  return data.creatorInfo;
}

export function useTikTokCreatorInfo(accountId: string, enabled = true) {
  const { copy } = useUiCopy();
  return useQuery({
    queryKey: queryKeys.tiktokCreatorInfo(accountId),
    queryFn: () => fetchCreatorInfo(accountId, copy),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
