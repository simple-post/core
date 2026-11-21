"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPlatformById } from "@/components/visual/platforms";
import type { SummaryMode } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { AnalyticsPeriod } from "@/lib/post-analytics/periods";
import { cn } from "@/lib/utils";

import { formatRelativeTime } from "../format";
import { useAnalyticsLabels } from "../labels";

const QUICK_PERIODS: AnalyticsPeriod[] = ["last_24h", "last_7d", "last_30d", "last_90d", "last_365d"];
const MORE_PERIODS: AnalyticsPeriod[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "all_time",
  "custom",
];

export interface DashboardFilters {
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  platform?: string;
  mode: SummaryMode;
}

export function FiltersBar({
  filters,
  platforms,
  onChange,
  onRefresh,
  refreshing,
  lastUpdatedAt,
  readOnly,
}: {
  filters: DashboardFilters;
  platforms: string[];
  onChange: (next: Partial<DashboardFilters>) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdatedAt: string | null;
  readOnly: boolean;
}) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const updated = formatRelativeTime(lastUpdatedAt, locale);
  const isQuick = QUICK_PERIODS.includes(filters.period);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-xl border border-border bg-card p-1"
          role="group"
          aria-label={copy("Period")}>
          {QUICK_PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              title={labels.period[period as Exclude<AnalyticsPeriod, "custom">]}
              aria-pressed={filters.period === period}
              onClick={() => onChange({ period, from: undefined, to: undefined })}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                filters.period === period
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}>
              {labels.shortPeriod[period]}
            </button>
          ))}
        </div>
        <Select
          value={isQuick ? "" : filters.period}
          onValueChange={(value) => onChange({ period: value as AnalyticsPeriod })}>
          <SelectTrigger className={cn("h-10 w-auto min-w-36 rounded-xl", !isQuick && "border-primary/70")}>
            <SelectValue placeholder={copy("More periods")} />
          </SelectTrigger>
          <SelectContent>
            {MORE_PERIODS.map((period) => (
              <SelectItem key={period} value={period}>
                {period === "custom" ? copy("Custom range") : labels.period[period]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.period === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label={copy("From")}
              className="h-10 w-40"
              value={filters.from ?? ""}
              max={filters.to}
              onChange={(event) => onChange({ from: event.target.value || undefined })}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              aria-label={copy("To")}
              className="h-10 w-40"
              value={filters.to ?? ""}
              min={filters.from}
              onChange={(event) => onChange({ to: event.target.value || undefined })}
            />
          </div>
        )}

        <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {refreshing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {copy("Updating…")}
            </span>
          ) : updated ? (
            <span>{copy("Updated {{time}}", { time: updated })}</span>
          ) : null}
          {!readOnly && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              {copy("Refresh")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={copy("Platform")}>
          <button
            type="button"
            aria-pressed={!filters.platform}
            onClick={() => onChange({ platform: undefined })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filters.platform
                ? "border-border text-muted-foreground hover:text-foreground"
                : "border-foreground bg-foreground text-background",
            )}>
            {copy("All platforms")}
          </button>
          {platforms.map((platform) => (
            <button
              key={platform}
              type="button"
              aria-pressed={filters.platform === platform}
              onClick={() => onChange({ platform: filters.platform === platform ? undefined : platform })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border py-1 ps-1 pe-3 text-xs font-medium transition-colors",
                filters.platform === platform
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}>
              <PlatformIconBadge platform={platform} className="size-5 border-0" />
              {getPlatformById(platform)?.name ?? platform}
            </button>
          ))}
        </div>
        <div
          className="ms-auto inline-flex rounded-lg border border-border p-0.5 text-xs"
          role="group"
          aria-label={copy("What to measure")}>
          {(
            [
              ["published", copy("Posts published in period")],
              ["activity", copy("Activity in period")],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={filters.mode === mode}
              onClick={() => onChange({ mode })}
              className={cn(
                "rounded-md px-2.5 py-1",
                filters.mode === mode ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
