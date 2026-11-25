"use client";

import { Bar, BarChart, XAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

import { formatNumber } from "../format";
import { SERIES_COLOR } from "../post-analytics-panel";

const MIN_POSTS = 3;

/** Average engagements by local publish weekday and hour; buckets with few posts are dimmed. */
export function BestTimes({ bestTimes }: { bestTimes: AnalyticsSummary["bestTimes"] }) {
  const { copy, locale } = useUiCopy();
  const measured = bestTimes.byWeekday.reduce(
    (sum, bucket) => sum + (bucket.averageEngagements === null ? 0 : bucket.posts),
    0,
  );
  const config: ChartConfig = { averageEngagements: { label: copy("Avg. engagements per post"), theme: SERIES_COLOR } };
  const weekdayName = (weekday: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + weekday)),
    );
  const hourName = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1, hour)));

  if (measured < MIN_POSTS) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {copy("Publish a few more posts in this period to see when your audience engages most.")}
      </p>
    );
  }

  const best = [...bestTimes.byWeekday].sort((a, b) => (b.averageEngagements ?? -1) - (a.averageEngagements ?? -1))[0];
  const bestHour = [...bestTimes.byHour]
    .filter((bucket) => bucket.posts >= 2)
    .sort((a, b) => (b.averageEngagements ?? -1) - (a.averageEngagements ?? -1))[0];
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => String(payload?.[0]?.payload?.label ?? "")}
          formatter={(value, _name, item) => (
            <div className="flex w-full flex-col gap-0.5">
              <span className="flex justify-between gap-4">
                <span className="text-muted-foreground">{copy("Avg. engagements per post")}</span>
                <span className="font-mono tabular-nums">{formatNumber(Number(value), locale)}</span>
              </span>
              <span className="text-muted-foreground">
                {copy("Based on {{count, number}} posts", { count: (item.payload as { posts: number }).posts })}
              </span>
            </div>
          )}
        />
      }
    />
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {bestHour
          ? copy("Your posts published on {{day}} around {{hour}} get the most engagement.", {
              day: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
                new Date(Date.UTC(2024, 0, 1 + best.weekday)),
              ),
              hour: hourName(bestHour.hour),
            })
          : copy("Your posts published on {{day}} get the most engagement.", {
              day: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
                new Date(Date.UTC(2024, 0, 1 + best.weekday)),
              ),
            })}
      </p>
      <ChartContainer config={config} className="aspect-auto h-32 w-full">
        <BarChart data={bestTimes.byWeekday.map((bucket) => ({ ...bucket, label: weekdayName(bucket.weekday) }))}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          {tooltip}
          <Bar
            dataKey="averageEngagements"
            fill="var(--color-averageEngagements)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <ChartContainer config={config} className="aspect-auto h-28 w-full">
        <BarChart data={bestTimes.byHour.map((bucket) => ({ ...bucket, label: hourName(bucket.hour) }))}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={2} />
          {tooltip}
          <Bar
            dataKey="averageEngagements"
            fill="var(--color-averageEngagements)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">{copy("Times are shown in your timezone.")}</p>
    </div>
  );
}
