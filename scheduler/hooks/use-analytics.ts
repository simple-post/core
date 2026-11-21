"use client";

import { useEffect, useRef } from "react";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { AnalyticsGranularity, AnalyticsPeriod } from "@/lib/post-analytics/periods";
import type {
  AccountAnalyticsOverview,
  AnalyticsSummary,
  PostAnalyticsView,
  PostSummaryItem,
  SortableMetric,
  SummaryMode,
} from "@/lib/post-analytics/query";
import { queryKeys } from "@/lib/query-client";
import { ApiResponseError } from "@/lib/utils/api-response-error";

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  timeZone?: string;
  granularity?: AnalyticsGranularity;
  platform?: string;
  accountId?: string;
  mode?: SummaryMode;
}

function toSearchParams(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new ApiResponseError(await response.json().catch(() => null), fallback, response.status);
  return (await response.json()) as T;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Analytics of one post; stale values are refreshed in the background after the cached ones render. */
export function usePostAnalytics(postId: string, options: { enabled?: boolean; readOnly?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const { copy } = useUiCopy();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.postAnalytics(postId),
    enabled: enabled && Boolean(postId),
    staleTime: 60_000,
    queryFn: async () =>
      getJson<{ analytics: PostAnalyticsView }>(
        `/api/v1/posts/${encodeURIComponent(postId)}/analytics?refresh=none`,
        copy("Failed to load analytics"),
      ).then((body) => body.analytics),
  });

  const refresh = useMutation({
    mutationFn: async (force: boolean) =>
      getJson<{ analytics: PostAnalyticsView }>(
        `/api/v1/posts/${encodeURIComponent(postId)}/analytics?refresh=${force ? "force" : "auto"}`,
        copy("Failed to refresh analytics"),
      ).then((body) => body.analytics),
    onSuccess: (analytics) => {
      queryClient.setQueryData(queryKeys.postAnalytics(postId), analytics);
      void queryClient.invalidateQueries({ queryKey: ["analytics", "summary"] });
    },
  });

  // Opening a post fetches fresh numbers once when the cached ones are stale.
  const autoRefreshed = useRef<string | null>(null);
  useEffect(() => {
    if (options.readOnly || !query.data?.isStale || autoRefreshed.current === postId || refresh.isPending) return;
    autoRefreshed.current = postId;
    refresh.mutate(false);
  }, [options.readOnly, postId, query.data?.isStale, refresh]);

  return { ...query, refresh };
}

export function useAnalyticsSummary(
  filters: AnalyticsFilters & { topSortBy?: SortableMetric; topLimit?: number },
  enabled = true,
) {
  const { copy } = useUiCopy();
  const params = toSearchParams({ ...filters, refresh: "none" });
  return useQuery({
    queryKey: queryKeys.analyticsSummary(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () =>
      getJson<{ summary: AnalyticsSummary }>(
        `/api/v1/analytics/summary?${params}`,
        copy("Failed to load analytics"),
      ).then((body) => body.summary),
  });
}

export function useAnalyticsPosts(
  filters: AnalyticsFilters & { sortBy?: SortableMetric; order?: "asc" | "desc"; page?: number; limit?: number },
) {
  const { copy } = useUiCopy();
  const params = toSearchParams({ ...filters, refresh: "none" });
  return useQuery({
    queryKey: queryKeys.analyticsPosts(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: () =>
      getJson<{
        posts: PostSummaryItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/api/v1/analytics/posts?${params}`, copy("Failed to load analytics")),
  });
}

export function useAccountAnalytics() {
  const { copy } = useUiCopy();
  return useQuery({
    queryKey: queryKeys.accountAnalytics,
    staleTime: 60_000,
    queryFn: async () =>
      getJson<{ accounts: AccountAnalyticsOverview[] }>(
        "/api/v1/analytics/accounts",
        copy("Failed to load analytics"),
      ).then((body) => body.accounts),
  });
}

export interface RefreshAnalyticsResult {
  posts: { refreshed: number; succeeded: number; failed: number; skipped: number };
  accounts: number;
}

/** Refreshes stale analytics for a period, then reloads every analytics view. */
export function useRefreshAnalytics() {
  const { copy } = useUiCopy();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      period?: AnalyticsPeriod;
      from?: string;
      to?: string;
      timeZone?: string;
      mode?: SummaryMode;
      platforms?: string[];
      force?: boolean;
    }) => {
      const response = await fetch("/api/v1/analytics/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new ApiResponseError(
          await response.json().catch(() => null),
          copy("Failed to refresh analytics"),
          response.status,
        );
      return (await response.json()) as RefreshAnalyticsResult;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.analytics }),
  });
}

export {
  type AccountAnalyticsOverview,
  type AnalyticsSummary,
  type PostAnalyticsView,
  type PostSummaryItem,
  type SortableMetric,
  type SummaryMode,
} from "@/lib/post-analytics/query";
