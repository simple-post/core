"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { AlertTriangle, BarChart3, Info } from "lucide-react";
import { toast } from "sonner";

import { PlatformFilter } from "@/components/platform-filter";
import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { workspaceHref } from "@/components/workspaces/switcher";
import {
  browserTimeZone,
  useAnalyticsSummary,
  useRefreshAnalytics,
  type AnalyticsFilters,
} from "@/hooks/use-analytics";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { reconnectHref } from "@/lib/accounts/reconnect-navigation";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/post-analytics/periods";
import { cn } from "@/lib/utils";

import { formatMetricValue, formatPercent, formatNumber } from "../format";
import { useAnalyticsLabels } from "../labels";
import { MetricTile } from "../metric-tile";

import { BestTimes } from "./best-times";
import { BreakdownTable } from "./breakdown-table";
import { FiltersBar, type DashboardFilters } from "./filters-bar";
import { PostsTable } from "./posts-table";
import { TimelineChart, type TimelineMetric } from "./timeline-chart";

import type { PostMetric } from "@simple-post/sdk/analytics";

const METRIC_TILES: TimelineMetric[] = [
  "posts",
  "views",
  "engagements",
  "engagementRate",
  "likes",
  "comments",
  "shares",
  "followers",
  "reach",
  "quotes",
  "saves",
  "clicks",
  "profileVisits",
  "follows",
  "watchTimeSeconds",
  "averageWatchTimeSeconds",
];

function Section({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function readFilters(params: URLSearchParams): DashboardFilters {
  const period = params.get("period");

  return {
    period: ANALYTICS_PERIODS.includes(period as AnalyticsPeriod) ? (period as AnalyticsPeriod) : "last_30d",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    platforms: [
      ...new Set(
        params
          .getAll("platform")
          .flatMap((entry) => entry.split(","))
          .filter((platform) => platform && platform !== "linkedin"),
      ),
    ],
  };
}

export function AnalyticsDashboard({ workspaceId, canManage = true }: { workspaceId?: string; canManage?: boolean }) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const readOnly = useWorkspaceReadOnly() || !canManage;
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams?.toString())), [searchParams]);
  const [timeZone] = useState(browserTimeZone);
  const [chartMetric, setChartMetric] = useState<TimelineMetric>("engagements");

  const customIncomplete = filters.period === "custom" && (!filters.from || !filters.to);
  const queryFilters: AnalyticsFilters = {
    workspace: workspaceId,
    period: customIncomplete ? "last_30d" : filters.period,
    ...(filters.period === "custom" && !customIncomplete ? { from: filters.from, to: filters.to } : {}),
    timeZone,
    platform: filters.platforms.join(",") || undefined,
  };
  const {
    data: summary,
    isLoading,
    isError,
    isFetching,
    isPlaceholderData,
  } = useAnalyticsSummary({ ...queryFilters, topLimit: 0 }, !customIncomplete);
  const refresh = useRefreshAnalytics();

  const updateFilters = useCallback(
    (update: Partial<DashboardFilters> | ((current: DashboardFilters) => Partial<DashboardFilters>)) => {
      const current = readFilters(new URLSearchParams(window.location.search));
      const merged = { ...current, ...(typeof update === "function" ? update(current) : update) };
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspace", workspaceId);
      if (merged.period !== "last_30d") params.set("period", merged.period);
      if (merged.period === "custom" && merged.from) params.set("from", merged.from);
      if (merged.period === "custom" && merged.to) params.set("to", merged.to);
      if (merged.platforms.length > 0) params.set("platform", [...merged.platforms].sort().join(","));
      window.history.replaceState(null, "", params.size > 0 ? `${pathname}?${params}` : pathname);
    },
    [pathname, workspaceId],
  );

  const runRefresh = useCallback(
    (force: boolean) =>
      refresh.mutate(
        {
          workspace: workspaceId,
          period: queryFilters.period,
          from: queryFilters.from,
          to: queryFilters.to,
          timeZone,
          ...(queryFilters.platform ? { platforms: queryFilters.platform.split(",") } : {}),
          force,
        },
        {
          onSuccess: (result) => {
            if (force && result.posts.failed > 0)
              toast.warning(copy("Some platforms could not be read. Check the notes below."));
          },
          // Automatic refreshes fail quietly; the cached numbers stay on screen.
          onError: (error) => {
            if (force) toast.error(error instanceof Error ? error.message : copy("Failed to refresh analytics"));
          },
        },
      ),

    [
      refresh,
      workspaceId,
      queryFilters.period,
      queryFilters.from,
      queryFilters.to,
      queryFilters.platform,
      timeZone,
      copy,
    ],
  );

  // Opening the dashboard (or a new period) reads stale numbers once, after the cached ones render.
  const refreshedKey = useRef<string | null>(null);
  const refreshKey = `${queryFilters.period}|${queryFilters.from ?? ""}|${queryFilters.to ?? ""}|${queryFilters.platform ?? ""}`;
  useEffect(() => {
    if (
      readOnly ||
      customIncomplete ||
      !summary ||
      isPlaceholderData ||
      refresh.isPending ||
      refreshedKey.current === refreshKey
    )
      return;
    if (summary.coverage.stale === 0 && summary.coverage.pending === 0 && summary.followers.length > 0) return;
    refreshedKey.current = refreshKey;
    runRefresh(false);
  }, [readOnly, customIncomplete, summary, isPlaceholderData, refresh.isPending, refreshKey, runRefresh]);

  const supportedMetrics = useMemo(() => {
    const metrics = new Set<PostMetric>();
    for (const platform of summary?.byPlatform ?? [])
      for (const metric of platform.supportedMetrics) metrics.add(metric);
    return metrics;
  }, [summary]);

  const platforms = summary?.platforms ?? [];
  const followerCounts = summary?.followers.flatMap((entry) => entry.current ?? []) ?? [];
  const followerTotal = followerCounts.length > 0 ? followerCounts.reduce((sum, value) => sum + value, 0) : null;
  const followerChanges = summary?.followers.flatMap((entry) => entry.change ?? []) ?? [];
  const followerChange =
    followerChanges.length > 0 && followerChanges.length === followerCounts.length
      ? followerChanges.reduce((sum, value) => sum + value, 0)
      : null;
  const metricLabel = (metric: TimelineMetric) =>
    metric === "followers" ? labels.accountMetric.followers : labels.metric[metric];

  // The API reports the engagement-rate change in points; tiles show every change as relative.
  const tileChange = (metric: TimelineMetric): number | null => {
    if (!summary?.change) return null;
    if (metric !== "engagementRate") return summary.change[metric] ?? null;
    const current = summary.totals.engagementRate;
    const previous = summary.previous?.engagementRate;
    return current !== null && previous ? (current - previous) / previous : null;
  };

  const tileValue = (metric: TimelineMetric): string => {
    if (!summary) return "—";
    if (metric === "followers") return formatMetricValue("engagements", followerTotal, locale);
    if (metric === "posts") return formatMetricValue("engagements", summary.totals.posts, locale);
    if (metric === "engagementRate") return formatPercent(summary.totals.engagementRate, locale, 2);
    if (metric === "engagements") return formatMetricValue("engagements", summary.totals.engagements, locale);
    return formatMetricValue(metric, summary.totals.metrics[metric as PostMetric], locale);
  };

  const periodLabel =
    filters.period === "custom"
      ? copy("Custom range")
      : labels.period[filters.period as Exclude<AnalyticsPeriod, "custom">];

  return (
    <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-8 sm:py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{copy("Analytics Dashboard")}</h1>
        <FiltersBar
          filters={filters}
          onChange={updateFilters}
          onRefresh={() => runRefresh(true)}
          refreshing={refresh.isPending}
          lastUpdatedAt={summary?.coverage.lastUpdatedAt ?? null}
          readOnly={readOnly || customIncomplete}
        />
      </header>
      <div className="space-y-5">
        <PlatformFilter
          platforms={platforms}
          selected={filters.platforms}
          onChange={(update) => updateFilters((current) => ({ platforms: update(current.platforms) }))}
        />
        {summary && summary.notices.length > 0 && (
          <div className="space-y-2">
            {summary.notices.map((notice) => (
              <div
                key={notice.accountId}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm",
                  notice.reconnectRecommended
                    ? "border-amber-500/30 bg-amber-500/10"
                    : "border-border bg-card text-muted-foreground",
                )}>
                {notice.reconnectRecommended ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                ) : (
                  <Info className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <PlatformIconBadge platform={notice.platform} className="size-5" />
                <span className="min-w-0 flex-1">
                  {notice.username ? (
                    <span className="font-medium">@{notice.username.replace(/^@/, "")} · </span>
                  ) : null}
                  {notice.message}
                </span>
                {notice.reconnectRecommended && !readOnly && (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={reconnectHref(
                        notice.accountId,
                        `${pathname}${searchParams?.size ? `?${searchParams}` : ""}`,
                        workspaceId,
                      )}>
                      {copy("Reconnect")}
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {customIncomplete ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {copy("Pick a start and end date for the custom range.")}
          </div>
        ) : null}

        {isError && !customIncomplete ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            {copy("Analytics could not be loaded. Please try again.")}
          </div>
        ) : null}

        {!customIncomplete && (
          <>
            <div
              className={cn(
                "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8",
                (isLoading || isFetching) && !refresh.isPending && "opacity-70",
              )}>
              {METRIC_TILES.map((metric) => (
                <MetricTile
                  key={metric}
                  locale={locale}
                  label={metricLabel(metric)}
                  value={isLoading ? "…" : tileValue(metric)}
                  valueTitle={
                    metric === "followers" && followerTotal !== null ? formatNumber(followerTotal, locale) : undefined
                  }
                  help={metric === "followers" ? undefined : labels.metricHelp[metric]}
                  change={tileChange(metric)}
                  changeLabel={summary?.previous && metric !== "followers" ? copy("vs previous") : undefined}
                  footer={
                    metric === "followers" && followerChange !== null ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(followerChange)}{" "}
                        {copy("in period")}
                      </span>
                    ) : null
                  }
                  active={chartMetric === metric}
                  onClick={() => setChartMetric(metric)}
                  className="gap-1 rounded-xl p-2.5 xl:p-3"
                />
              ))}
            </div>

            <Section
              title={metricLabel(chartMetric)}
              description={
                chartMetric === "followers"
                  ? periodLabel
                  : copy("{{period}} · by publish date", { period: periodLabel })
              }>
              {summary ? (
                <TimelineChart summary={summary} metric={chartMetric} />
              ) : (
                <div className="h-64 animate-pulse rounded-xl bg-secondary" />
              )}
            </Section>

            <Section
              title={copy("Accounts")}
              action={
                <Link
                  className="text-xs text-primary underline-offset-4 hover:underline"
                  href={workspaceHref("/accounts", workspaceId)}>
                  {copy("Manage accounts")}
                </Link>
              }>
              {summary ? (
                <BreakdownTable accounts={summary.byAccount} />
              ) : (
                <div className="h-28 animate-pulse rounded-xl bg-secondary" />
              )}
            </Section>

            <Section
              title={copy("Best time to post")}
              description={copy("Average engagements by the time posts were published.")}>
              {summary ? (
                <BestTimes bestTimes={summary.bestTimes} />
              ) : (
                <div className="h-40 animate-pulse rounded-xl bg-secondary" />
              )}
            </Section>

            <Section title={copy("All posts")}>
              <PostsTable filters={queryFilters} supportedMetrics={supportedMetrics} />
            </Section>
          </>
        )}

        {summary && !customIncomplete && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden />
            <span>
              {copy("Numbers for {{withData, number}} of {{total, number}} publications.", {
                withData: summary.coverage.withData,
                total: summary.coverage.publications,
              })}
            </span>
            {summary.coverage.pending > 0 ? (
              <span>
                {copy("{{count, number}} waiting for their first read.", { count: summary.coverage.pending })}
              </span>
            ) : null}
            <span>{copy("Recent posts refresh every 15 minutes, older posts less often.")}</span>
          </p>
        )}
      </div>
    </main>
  );
}
