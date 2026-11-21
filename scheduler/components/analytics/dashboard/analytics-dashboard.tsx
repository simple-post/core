"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AlertTriangle, ArrowLeft, BarChart3, Info } from "lucide-react";
import { toast } from "sonner";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { getPlatformById } from "@/components/visual/platforms";
import {
  browserTimeZone,
  useAnalyticsSummary,
  useRefreshAnalytics,
  type AnalyticsFilters,
  type SortableMetric,
  type SummaryMode,
} from "@/hooks/use-analytics";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { reconnectHref } from "@/lib/accounts/reconnect-navigation";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/post-analytics/periods";
import { cn } from "@/lib/utils";

import { formatMetricValue, formatPercent } from "../format";
import { useAnalyticsLabels } from "../labels";
import { MetricTile } from "../metric-tile";

import { BestTimes } from "./best-times";
import { BreakdownTable } from "./breakdown-table";
import { FiltersBar, type DashboardFilters } from "./filters-bar";
import { FollowersPanel } from "./followers-panel";
import { PostsTable } from "./posts-table";
import { TimelineChart, type TimelineMetric } from "./timeline-chart";
import { TOP_POST_SORTS, TopPosts } from "./top-posts";

import type { PostMetric } from "@simple-post/sdk/analytics";

const DEFAULT_TILES: TimelineMetric[] = [
  "posts",
  "views",
  "engagements",
  "engagementRate",
  "likes",
  "comments",
  "shares",
];
const PLATFORM_TILE_ORDER: TimelineMetric[] = [
  "posts",
  "views",
  "reach",
  "engagements",
  "engagementRate",
  "likes",
  "comments",
  "shares",
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
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function readFilters(params: URLSearchParams): DashboardFilters {
  const period = params.get("period");
  const mode = params.get("mode");
  return {
    period: ANALYTICS_PERIODS.includes(period as AnalyticsPeriod) ? (period as AnalyticsPeriod) : "last_30d",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    platform: params.get("platform") ?? undefined,
    mode: mode === "activity" ? "activity" : ("published" as SummaryMode),
  };
}

export function AnalyticsDashboard() {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const readOnly = useWorkspaceReadOnly();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams?.toString())), [searchParams]);
  const [timeZone] = useState(browserTimeZone);
  const [chartMetric, setChartMetric] = useState<TimelineMetric>("engagements");
  const [topSortBy, setTopSortBy] = useState<SortableMetric>("engagements");

  const customIncomplete = filters.period === "custom" && (!filters.from || !filters.to);
  const queryFilters: AnalyticsFilters = {
    period: customIncomplete ? "last_30d" : filters.period,
    ...(filters.period === "custom" && !customIncomplete ? { from: filters.from, to: filters.to } : {}),
    timeZone,
    platform: filters.platform,
    mode: filters.mode,
  };
  const {
    data: summary,
    isLoading,
    isError,
    isFetching,
  } = useAnalyticsSummary({ ...queryFilters, topSortBy }, !customIncomplete);
  const refresh = useRefreshAnalytics();

  const updateFilters = useCallback(
    (next: Partial<DashboardFilters>) => {
      const merged = { ...filters, ...next };
      const params = new URLSearchParams();
      if (merged.period !== "last_30d") params.set("period", merged.period);
      if (merged.period === "custom" && merged.from) params.set("from", merged.from);
      if (merged.period === "custom" && merged.to) params.set("to", merged.to);
      if (merged.platform) params.set("platform", merged.platform);
      if (merged.mode !== "published") params.set("mode", merged.mode);
      router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  const runRefresh = useCallback(
    (force: boolean) =>
      refresh.mutate(
        {
          period: queryFilters.period,
          from: queryFilters.from,
          to: queryFilters.to,
          timeZone,
          mode: queryFilters.mode,
          ...(queryFilters.platform ? { platforms: [queryFilters.platform] } : {}),
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
      queryFilters.period,
      queryFilters.from,
      queryFilters.to,
      queryFilters.mode,
      queryFilters.platform,
      timeZone,
      copy,
    ],
  );

  // Opening the dashboard (or a new period) reads stale numbers once, after the cached ones render.
  const refreshedKey = useRef<string | null>(null);
  const refreshKey = `${queryFilters.period}|${queryFilters.from ?? ""}|${queryFilters.to ?? ""}|${queryFilters.mode}|${queryFilters.platform ?? ""}`;
  useEffect(() => {
    if (readOnly || customIncomplete || !summary || refresh.isPending || refreshedKey.current === refreshKey) return;
    if (summary.coverage.stale === 0 && summary.coverage.pending === 0) return;
    refreshedKey.current = refreshKey;
    runRefresh(false);
  }, [readOnly, customIncomplete, summary, refresh.isPending, refreshKey, runRefresh]);

  const supportedMetrics = useMemo(() => {
    const metrics = new Set<PostMetric>();
    for (const platform of summary?.byPlatform ?? [])
      for (const metric of platform.supportedMetrics) metrics.add(metric);
    return metrics;
  }, [summary]);

  const tiles = useMemo(() => {
    if (!summary) return DEFAULT_TILES;
    const candidates = filters.platform ? PLATFORM_TILE_ORDER : DEFAULT_TILES;
    return candidates.filter(
      (metric) =>
        metric === "posts" ||
        metric === "engagements" ||
        metric === "engagementRate" ||
        summary.totals.metrics[metric as PostMetric] !== undefined ||
        // Overview keeps the core tiles for platforms that report them, even before data arrives.
        (!filters.platform && supportedMetrics.has(metric as PostMetric)),
    );
  }, [summary, filters.platform, supportedMetrics]);
  const activeChartMetric = tiles.includes(chartMetric) ? chartMetric : "posts";

  const platforms = useMemo(() => {
    const known = new Set<string>([
      ...(summary?.byPlatform.map((entry) => entry.platform) ?? []),
      ...(summary?.followers.map((entry) => entry.platform) ?? []),
      ...(summary?.notices.map((entry) => entry.platform) ?? []),
    ]);
    if (filters.platform) known.add(filters.platform);
    return [...known].sort();
  }, [summary, filters.platform]);

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
    if (metric === "posts") return formatMetricValue("engagements", summary.totals.posts, locale);
    if (metric === "engagementRate") return formatPercent(summary.totals.engagementRate, locale, 2);
    if (metric === "engagements") return formatMetricValue("engagements", summary.totals.engagements, locale);
    return formatMetricValue(metric, summary.totals.metrics[metric as PostMetric], locale);
  };

  const followerTotal = summary?.followers.reduce((sum, entry) => sum + (entry.current ?? 0), 0) ?? 0;
  const followerChange = summary?.followers.reduce((sum, entry) => sum + (entry.change ?? 0), 0) ?? 0;
  const platformName = filters.platform ? (getPlatformById(filters.platform)?.name ?? filters.platform) : null;
  const periodLabel =
    filters.period === "custom"
      ? copy("Custom range")
      : labels.period[filters.period as Exclude<AnalyticsPeriod, "custom">];

  return (
    <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-8 sm:py-6">
      <div className="animate-reveal mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{copy("Analytics")}</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {filters.platform ? (
              <>
                <button
                  type="button"
                  onClick={() => updateFilters({ platform: undefined })}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={copy("All platforms")}>
                  <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
                </button>
                <PlatformIconBadge platform={filters.platform} className="size-7" iconClassName="text-xs" />
                {platformName}
              </>
            ) : (
              copy("How your posts perform")
            )}
          </h1>
        </div>
      </div>

      <div className="animate-reveal animate-reveal-delay-1 space-y-5">
        <FiltersBar
          filters={filters}
          platforms={platforms}
          onChange={updateFilters}
          onRefresh={() => runRefresh(true)}
          refreshing={refresh.isPending}
          lastUpdatedAt={summary?.coverage.lastUpdatedAt ?? null}
          readOnly={readOnly || customIncomplete}
        />

        {filters.mode === "activity" && (
          <p className="text-xs text-muted-foreground">
            {copy(
              "Activity shows what all your posts gained during the period, including older posts. It is based on the readings SimplePost took, so it is approximate.",
            )}
          </p>
        )}

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
                    <Link href={reconnectHref(notice.accountId, "/analytics")}>{copy("Reconnect")}</Link>
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
                "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]",
                (isLoading || isFetching) && !refresh.isPending && "opacity-70",
              )}>
              {tiles.map((metric) => (
                <MetricTile
                  key={metric}
                  locale={locale}
                  label={labels.metric[metric]}
                  help={labels.metricHelp[metric]}
                  value={isLoading ? "…" : tileValue(metric)}
                  change={tileChange(metric)}
                  changeLabel={summary?.previous ? copy("vs previous") : undefined}
                  active={activeChartMetric === metric}
                  onClick={() => setChartMetric(metric)}
                />
              ))}
              {summary && summary.followers.length > 0 && (
                <MetricTile
                  locale={locale}
                  label={labels.accountMetric.followers}
                  value={formatMetricValue("engagements", followerTotal, locale)}
                  footer={
                    followerChange === 0 ? undefined : (
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          followerChange > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400",
                        )}>
                        {followerChange > 0 ? "+" : ""}
                        {formatMetricValue("engagements", followerChange, locale)} {copy("in period")}
                      </span>
                    )
                  }
                />
              )}
            </div>

            <Section
              title={labels.metric[activeChartMetric]}
              description={
                filters.mode === "activity"
                  ? copy("{{period}} · gained per interval", { period: periodLabel })
                  : copy("{{period}} · by publish date", { period: periodLabel })
              }>
              {summary ? (
                <TimelineChart summary={summary} metric={activeChartMetric} />
              ) : (
                <div className="h-64 animate-pulse rounded-xl bg-secondary" />
              )}
            </Section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Section
                title={filters.platform ? copy("Accounts") : copy("Platforms")}
                description={filters.platform ? undefined : copy("Select a platform to drill down.")}>
                {summary ? (
                  <BreakdownTable
                    summary={summary}
                    drilledPlatform={filters.platform}
                    onSelectPlatform={(platform) => updateFilters({ platform })}
                  />
                ) : (
                  <div className="h-40 animate-pulse rounded-xl bg-secondary" />
                )}
              </Section>
              <Section title={copy("Top posts")}>
                {summary ? (
                  <TopPosts
                    posts={summary.topPosts}
                    sortBy={TOP_POST_SORTS.includes(topSortBy) ? topSortBy : "engagements"}
                    onSortChange={setTopSortBy}
                  />
                ) : (
                  <div className="h-40 animate-pulse rounded-xl bg-secondary" />
                )}
              </Section>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Section
                title={copy("Best time to post")}
                description={copy("Average engagements by the time posts were published.")}>
                {summary ? (
                  <BestTimes bestTimes={summary.bestTimes} />
                ) : (
                  <div className="h-40 animate-pulse rounded-xl bg-secondary" />
                )}
              </Section>
              <Section title={labels.accountMetric.followers}>
                {summary ? (
                  <FollowersPanel followers={summary.followers} />
                ) : (
                  <div className="h-40 animate-pulse rounded-xl bg-secondary" />
                )}
              </Section>
            </div>

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
