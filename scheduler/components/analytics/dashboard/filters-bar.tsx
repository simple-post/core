"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/post-analytics/periods";

import { formatRelativeTime } from "../format";
import { useAnalyticsLabels } from "../labels";

export interface DashboardFilters {
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  platforms: string[];
}

export function FiltersBar({
  filters,
  onChange,
  onRefresh,
  refreshing,
  lastUpdatedAt,
  readOnly,
}: {
  filters: DashboardFilters;
  onChange: (next: Partial<DashboardFilters>) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdatedAt: string | null;
  readOnly: boolean;
}) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const updated = formatRelativeTime(lastUpdatedAt, locale);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={filters.period} onValueChange={(value) => onChange({ period: value as AnalyticsPeriod })}>
        <SelectTrigger aria-label={copy("Period")} className="w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ANALYTICS_PERIODS.map((period) => (
            <SelectItem key={period} value={period}>
              {period === "custom" ? copy("Custom range") : labels.period[period]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filters.period === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label={copy("From")}
            className="w-auto"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(event) => onChange({ from: event.target.value || undefined })}
          />
          <Input
            type="date"
            aria-label={copy("To")}
            className="w-auto"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(event) => onChange({ to: event.target.value || undefined })}
          />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span role="status" className="hidden sm:inline">
          {refreshing ? copy("Updating…") : updated ? copy("Updated {{time}}", { time: updated }) : null}
        </span>
        {!readOnly && (
          <Button
            variant="outline"
            size="icon"
            aria-label={copy("Refresh")}
            title={copy("Refresh")}
            onClick={onRefresh}
            disabled={refreshing}>
            {refreshing ? <Loader2 className="motion-safe:animate-spin" /> : <RefreshCw />}
          </Button>
        )}
      </div>
    </div>
  );
}
