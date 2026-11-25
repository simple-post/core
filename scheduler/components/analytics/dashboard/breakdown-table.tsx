"use client";

import { ChevronRight } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { getPlatformById } from "@/components/visual/platforms";
import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

import { formatCompact, formatPercent } from "../format";
import { useAnalyticsLabels } from "../labels";

type Row = {
  key: string;
  platform: string;
  title: string;
  subtitle?: string;
  posts: number;
  views?: number;
  engagements: number | null;
  engagementRate: number | null;
  share: number | null;
  followers?: number | null;
  followersChange?: number | null;
};

/** Per-platform (or, when drilled into a platform, per-account) breakdown with an engagement share bar. */
export function BreakdownTable({
  summary,
  drilledPlatform,
  onSelectPlatform,
}: {
  summary: AnalyticsSummary;
  drilledPlatform?: string;
  onSelectPlatform: (platform: string) => void;
}) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const totalEngagements = summary.totals.engagements ?? 0;

  const rows: Row[] = drilledPlatform
    ? summary.byAccount.map((account) => ({
        key: account.accountId,
        platform: account.platform,
        title: account.username ? `@${account.username.replace(/^@/, "")}` : (account.displayName ?? account.platform),
        subtitle: account.displayName && account.username ? account.displayName : undefined,
        posts: account.posts,
        views: account.metrics.views,
        engagements: account.engagements,
        engagementRate: account.engagementRate,
        share: totalEngagements > 0 && account.engagements !== null ? account.engagements / totalEngagements : null,
        followers: account.followers,
        followersChange: account.followersChange,
      }))
    : summary.byPlatform.map((platform) => ({
        key: platform.platform,
        platform: platform.platform,
        title: getPlatformById(platform.platform)?.name ?? platform.platform,
        subtitle: copy("{{count, number}} social accounts", { count: platform.accounts }),
        posts: platform.posts,
        views: platform.metrics.views,
        engagements: platform.engagements,
        engagementRate: platform.engagementRate,
        share: platform.share,
      }));

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{copy("No published posts in this period.")}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-border text-start font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <th className="py-2 text-start font-normal">{drilledPlatform ? copy("Account") : copy("Platform")}</th>
            <th className="px-2 py-2 text-end font-normal">{labels.metric.posts}</th>
            <th className="px-2 py-2 text-end font-normal">{labels.metric.views}</th>
            <th className="px-2 py-2 text-end font-normal">{labels.metric.engagements}</th>
            <th className="px-2 py-2 text-end font-normal">{labels.metric.engagementRate}</th>
            {drilledPlatform ? (
              <th className="px-2 py-2 text-end font-normal">{labels.accountMetric.followers}</th>
            ) : null}
            <th className="w-32 py-2 ps-3 text-start font-normal">{copy("Share of engagement")}</th>
            {drilledPlatform ? null : <th className="w-6" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={
                drilledPlatform
                  ? "border-b border-border/60"
                  : "cursor-pointer border-b border-border/60 hover:bg-secondary/40"
              }
              onClick={drilledPlatform ? undefined : () => onSelectPlatform(row.platform)}>
              <td className="py-2.5">
                {drilledPlatform ? (
                  <div className="flex items-center gap-2">
                    <PlatformIconBadge platform={row.platform} className="size-6" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.title}</div>
                      {row.subtitle ? (
                        <div className="truncate text-xs text-muted-foreground">{row.subtitle}</div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-2 text-start"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectPlatform(row.platform);
                    }}>
                    <PlatformIconBadge platform={row.platform} className="size-6" />
                    <span>
                      <span className="block font-medium">{row.title}</span>
                      {row.subtitle ? (
                        <span className="block text-xs text-muted-foreground">{row.subtitle}</span>
                      ) : null}
                    </span>
                  </button>
                )}
              </td>
              <td className="px-2 py-2.5 text-end tabular-nums">{formatCompact(row.posts, locale)}</td>
              <td className="px-2 py-2.5 text-end tabular-nums">{formatCompact(row.views, locale)}</td>
              <td className="px-2 py-2.5 text-end tabular-nums">{formatCompact(row.engagements, locale)}</td>
              <td className="px-2 py-2.5 text-end tabular-nums">{formatPercent(row.engagementRate, locale, 2)}</td>
              {drilledPlatform ? (
                <td className="px-2 py-2.5 text-end tabular-nums">
                  {formatCompact(row.followers, locale)}
                  {row.followersChange ? (
                    <span
                      className={
                        row.followersChange > 0
                          ? "ms-1 text-xs text-emerald-600 dark:text-emerald-400"
                          : "ms-1 text-xs text-red-600 dark:text-red-400"
                      }>
                      {row.followersChange > 0 ? "+" : ""}
                      {formatCompact(row.followersChange, locale)}
                    </span>
                  ) : null}
                </td>
              ) : null}
              <td className="py-2.5 ps-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-foreground/70"
                      style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-end text-xs tabular-nums text-muted-foreground">
                    {formatPercent(row.share, locale, 0)}
                  </span>
                </div>
              </td>
              {drilledPlatform ? null : (
                <td className="py-2.5 text-muted-foreground">
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
