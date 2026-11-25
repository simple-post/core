"use client";

import { Line, LineChart, YAxis } from "recharts";

import { PlatformIconBadge } from "@/components/platform-icons";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { getPlatformById } from "@/components/visual/platforms";
import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

import { formatCompact } from "../format";
import { SERIES_COLOR } from "../post-analytics-panel";

/** Current followers per account with growth during the period and a sparkline. */
export function FollowersPanel({ followers }: { followers: AnalyticsSummary["followers"] }) {
  const { copy, locale } = useUiCopy();
  const config: ChartConfig = { followers: { label: copy("Followers"), theme: SERIES_COLOR } };
  if (followers.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {copy("Follower counts appear after SimplePost reads your accounts for the first time.")}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {followers.map((entry) => (
        <li key={entry.accountId} className="flex items-center gap-3 py-2.5">
          <PlatformIconBadge platform={entry.platform} className="size-6" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {entry.username
                ? `@${entry.username.replace(/^@/, "")}`
                : (getPlatformById(entry.platform)?.name ?? entry.platform)}
            </div>
            <div className="text-xs text-muted-foreground">{getPlatformById(entry.platform)?.name}</div>
          </div>
          {entry.series.length >= 2 ? (
            <ChartContainer config={config} className="aspect-auto h-8 w-20" aria-hidden>
              <LineChart data={entry.series}>
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Line
                  dataKey="followers"
                  stroke="var(--color-followers)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          ) : null}
          <div className="w-20 text-end">
            <div className="font-semibold tabular-nums">{formatCompact(entry.current, locale)}</div>
            {entry.change !== null && entry.change !== 0 ? (
              <div
                className={cn(
                  "text-xs tabular-nums",
                  entry.change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                )}>
                {entry.change > 0 ? "+" : ""}
                {formatCompact(entry.change, locale)}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{copy("No change")}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
