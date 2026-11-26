"use client";

import { PlatformIconBadge } from "@/components/platform-icons";
import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

import { formatCompact, formatNumber, formatPercent } from "../format";
import { useAnalyticsLabels } from "../labels";

export function BreakdownTable({ accounts }: { accounts: AnalyticsSummary["byAccount"] }) {
  const { copy, locale } = useUiCopy();
  const { metric, accountMetric } = useAnalyticsLabels();

  if (accounts.length === 0)
    return <p className="py-3 text-sm text-muted-foreground">{copy("No connected accounts")}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[35rem] text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 text-start font-medium">{copy("Account")}</th>
            {[metric.posts, metric.views, metric.engagements, metric.engagementRate, accountMetric.followers].map(
              (label) => (
                <th key={label} className="px-2 pb-2 text-end font-medium">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {accounts.map((account) => (
            <tr key={account.accountId}>
              <th scope="row" className="py-2 text-start font-medium">
                <span className="flex items-center gap-2">
                  <PlatformIconBadge platform={account.platform} className="size-6" />
                  <span>{account.displayName || account.username || account.platform}</span>
                </span>
              </th>
              <td className="px-2 py-2 text-end tabular-nums">{formatCompact(account.posts, locale)}</td>
              <td className="px-2 py-2 text-end tabular-nums">{formatCompact(account.metrics.views, locale)}</td>
              <td className="px-2 py-2 text-end tabular-nums">{formatCompact(account.engagements, locale)}</td>
              <td className="px-2 py-2 text-end tabular-nums">{formatPercent(account.engagementRate, locale, 2)}</td>
              <td
                className="px-2 py-2 text-end tabular-nums"
                title={account.followers === null ? undefined : formatNumber(account.followers, locale)}>
                {formatCompact(account.followers, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
