"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

import { formatMetricValue, formatPercent } from "../format";
import { useAnalyticsLabels, type MetricKey } from "../labels";
import { SERIES_COLOR } from "../post-analytics-panel";

export type TimelineMetric = Exclude<MetricKey, "publishedAt">;

function bucketLabel(
  iso: string,
  granularity: AnalyticsSummary["period"]["granularity"],
  locale: string,
  timeZone: string,
) {
  const options: Intl.DateTimeFormatOptions =
    granularity === "hour"
      ? { hour: "numeric", day: "numeric", month: "short" }
      : granularity === "month"
        ? { month: "short", year: "numeric" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(iso));
}

/** One metric over the period; posts are counts per bucket (bars), metrics are areas. */
export function TimelineChart({ summary, metric }: { summary: AnalyticsSummary; metric: TimelineMetric }) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const { granularity, timeZone } = summary.period;
  const data = summary.timeline.map((bucket) => ({
    start: bucket.start,
    value:
      metric === "posts"
        ? bucket.posts
        : metric === "engagements"
          ? bucket.engagements
          : metric === "engagementRate"
            ? bucket.engagementRate
            : (bucket.metrics[metric] ?? null),
  }));
  const hasValues = data.some((point) => point.value !== null && point.value !== 0);
  const config: ChartConfig = { value: { label: labels.metric[metric], theme: SERIES_COLOR } };
  const format = (value: number | null) =>
    metric === "engagementRate"
      ? formatPercent(value, locale, 2)
      : formatMetricValue(metric === "posts" ? "engagements" : metric, value, locale);

  if (!hasValues) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        {copy("No data for this metric in the selected period yet.")}
      </div>
    );
  }

  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey="start"
        tickLine={false}
        axisLine={false}
        minTickGap={24}
        tickFormatter={(value: string) => bucketLabel(value, granularity, locale, timeZone)}
      />
      <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={(value: number) => format(value)} />
      <ChartTooltip
        cursor={metric === "posts" ? { fillOpacity: 0.4 } : true}
        content={
          <ChartTooltipContent
            labelFormatter={(_, payload) =>
              bucketLabel(String(payload?.[0]?.payload?.start), granularity, locale, timeZone)
            }
            formatter={(value) => (
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-muted-foreground">{labels.metric[metric]}</span>
                <span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
              </div>
            )}
          />
        }
      />
    </>
  );

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      {metric === "posts" ? (
        <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          {axes}
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          {axes}
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            fill="var(--color-value)"
            fillOpacity={0.12}
            connectNulls
            dot={data.length <= 31 ? { r: 2 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </AreaChart>
      )}
    </ChartContainer>
  );
}
