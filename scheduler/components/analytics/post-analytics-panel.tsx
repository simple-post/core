"use client";

import { useMemo, useState } from "react";

import Link from "next/link";

import { ChevronDown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { getPlatformById } from "@/components/visual/platforms";
import { usePostAnalytics } from "@/hooks/use-analytics";
import { reconnectHref } from "@/lib/accounts/reconnect-navigation";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

import { formatMetricValue, formatPercent, formatRelativeTime } from "./format";
import { useAnalyticsLabels, type MetricKey } from "./labels";
import { MetricTile } from "./metric-tile";

import type { PostMetric } from "@simple-post/sdk/analytics";

/** Validated single-series colors (light / dark surfaces). */
export const SERIES_COLOR = { light: "#4d7c0f", dark: "#7c9e10" };

const TILE_ORDER: Array<PostMetric | "engagements" | "engagementRate"> = [
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

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-500",
  pending: "bg-muted-foreground/50",
  rate_limited: "bg-amber-500",
  missing_permission: "bg-amber-500",
  credentials_error: "bg-red-500",
  error: "bg-red-500",
  not_found: "bg-muted-foreground/50",
  unsupported: "bg-muted-foreground/30",
};

export function PostAnalyticsPanel({ postId, readOnly }: { postId: string; readOnly?: boolean }) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const { data, isLoading, isError, refresh } = usePostAnalytics(postId);
  const [chartMetric, setChartMetric] = useState<"views" | "engagements">("engagements");
  const [showDetails, setShowDetails] = useState(false);

  const history = useMemo(
    () =>
      (data?.history ?? []).map((point) => ({
        at: point.at,
        views: point.metrics.views ?? null,
        engagements: point.engagements,
      })),
    [data],
  );
  const hasViewsHistory = history.some((point) => point.views !== null);
  const activeChartMetric = chartMetric === "views" && !hasViewsHistory ? "engagements" : chartMetric;

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6" aria-busy>
        <div className="h-4 w-32 animate-pulse rounded bg-secondary" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      </section>
    );
  }
  if (isError || !data || data.notPublished) return null;

  // Only metrics with a value: a platform that supports a metric may still not report it for this post.
  const tiles = TILE_ORDER.filter((metric) => {
    if (metric === "engagements") return data.totals.engagements !== null;
    if (metric === "engagementRate") return data.totals.engagementRate !== null;
    return data.totals.metrics[metric] !== undefined;
  });
  const updated = formatRelativeTime(data.lastUpdatedAt, locale);
  const anyData = data.accounts.some((account) => account.fetchedAt && account.status !== "unsupported");
  const chartConfig: ChartConfig = {
    [activeChartMetric]: { label: labels.metric[activeChartMetric], theme: SERIES_COLOR },
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby={`analytics-${postId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="section-kicker !mb-0">
          <span className="section-kicker-dot" />
          <span id={`analytics-${postId}`} className="section-kicker-label">
            {copy("Performance")}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {refresh.isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {copy("Updating…")}
            </span>
          ) : updated ? (
            <span>{copy("Updated {{time}}", { time: updated })}</span>
          ) : null}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(true)}>
              <RefreshCw className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")} />
              {copy("Refresh")}
            </Button>
          )}
        </div>
      </div>

      {anyData ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((metric) => (
            <MetricTile
              key={metric}
              locale={locale}
              label={labels.metric[metric]}
              help={labels.metricHelp[metric]}
              value={
                metric === "engagementRate"
                  ? formatPercent(data.totals.engagementRate, locale, 2)
                  : metric === "engagements"
                    ? formatMetricValue("engagements", data.totals.engagements, locale)
                    : formatMetricValue(metric, data.totals.metrics[metric], locale)
              }
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {refresh.isPending
            ? copy("Reading the first numbers from the platforms…")
            : copy("No analytics yet. Numbers appear once the platforms report them.")}
        </p>
      )}

      {history.length >= 2 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{copy("Growth since publishing")}</h3>
            {hasViewsHistory && (
              <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="group">
                {(["engagements", "views"] as const).map((metric) => (
                  <button
                    key={metric}
                    type="button"
                    aria-pressed={activeChartMetric === metric}
                    onClick={() => setChartMetric(metric)}
                    className={cn(
                      "rounded-md px-2 py-1",
                      activeChartMetric === metric ? "bg-secondary text-foreground" : "text-muted-foreground",
                    )}>
                    {labels.metric[metric]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
            <AreaChart data={history} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="at"
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickFormatter={(value: string) =>
                  new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric" }).format(
                    new Date(value),
                  )
                }
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatMetricValue("engagements", value, locale)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                        new Date(String(payload?.[0]?.payload?.at)),
                      )
                    }
                  />
                }
              />
              <Area
                dataKey={activeChartMetric}
                type="monotone"
                stroke={`var(--color-${activeChartMetric})`}
                strokeWidth={2}
                fill={`var(--color-${activeChartMetric})`}
                fillOpacity={0.12}
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}

      <ul className="mt-6 divide-y divide-border">
        {data.accounts.map((account) => {
          const platformName = getPlatformById(account.platform)?.name ?? account.platform;
          const values = (Object.keys(account.metrics) as PostMetric[]).filter(
            (metric) => account.metrics[metric] !== undefined,
          );
          return (
            <li key={account.accountId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
                <PlatformIconBadge platform={account.platform} className="size-7" iconClassName="text-xs" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {account.username
                      ? `@${account.username.replace(/^@/, "")}`
                      : (account.displayName ?? platformName)}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[account.status] ?? "bg-muted-foreground")}
                      aria-hidden
                    />
                    {labels.status[account.status] ?? account.status}
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {values.length > 0 ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {values.map((metric) => (
                      <div key={metric} className="flex items-baseline gap-1.5">
                        <dt className="text-xs text-muted-foreground">{labels.metric[metric as MetricKey]}</dt>
                        <dd className="font-medium tabular-nums">
                          {formatMetricValue(metric, account.metrics[metric], locale)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {account.message && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {account.message}
                    {account.reconnectRecommended && !readOnly && (
                      <>
                        {" "}
                        <Link
                          className="font-medium text-foreground underline underline-offset-2"
                          href={reconnectHref(account.accountId, `/posts/${postId}`)}>
                          {copy("Reconnect")}
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {showDetails && Object.keys(account.platformMetrics).length > 0 && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-lg bg-secondary/50 p-2 font-mono text-[11px] sm:grid-cols-2">
                    {Object.entries(account.platformMetrics).map(([name, value]) => (
                      <div key={name} className="flex justify-between gap-2">
                        <dt className="truncate text-muted-foreground">{name}</dt>
                        <dd className="tabular-nums">{value.toLocaleString(locale)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {account.postUrl && (
                <a
                  href={account.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {copy("Open on {{platform}}", { platform: platformName })}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {data.accounts.some((account) => Object.keys(account.platformMetrics).length > 0) && (
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-3 w-3 transition-transform", showDetails && "rotate-180")} />
          {showDetails ? copy("Hide platform details") : copy("Show all platform metrics")}
        </button>
      )}
    </section>
  );
}
