"use client";

import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

import { formatNumber } from "../format";

export function BestTimes({ bestTimes }: { bestTimes: AnalyticsSummary["bestTimes"] }) {
  const { copy, locale } = useUiCopy();
  const slots = bestTimes.bySlot;
  const peak = Math.max(1, ...slots.map((slot) => slot.averageEngagements ?? 0));
  const weekdayName = (weekday: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + weekday)),
    );
  const hourName = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1, hour)));

  return (
    <>
      <div className="relative overflow-x-auto pb-1" tabIndex={0} role="region" aria-label={copy("Best time to post")}>
        <table className="w-full min-w-[40rem] table-fixed border-separate border-spacing-1">
          <thead>
            <tr>
              <td className="sticky start-0 z-10 w-12 bg-card" />
              {Array.from({ length: 24 }, (_, hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="pb-1 text-start text-[10px] font-medium whitespace-nowrap text-muted-foreground"
                  aria-label={hourName(hour)}>
                  {hour % 3 === 0 ? hourName(hour) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, weekday) => (
              <tr key={weekday}>
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-card text-start text-xs font-medium text-muted-foreground">
                  {weekdayName(weekday)}
                </th>
                {slots.slice(weekday * 24, (weekday + 1) * 24).map(({ hour, posts, averageEngagements }) => {
                  const label =
                    averageEngagements === null
                      ? copy("No data")
                      : `${formatNumber(averageEngagements, locale)} · ${copy("Based on {{count, number}} posts", { count: posts })}`;
                  return (
                    <td
                      key={hour}
                      title={`${weekdayName(weekday)} · ${hourName(hour)} · ${label}`}
                      className={cn("h-5 rounded-sm", averageEngagements === null ? "bg-muted/60" : "bg-primary")}
                      style={
                        averageEngagements === null ? undefined : { opacity: 0.22 + 0.78 * (averageEngagements / peak) }
                      }>
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>{copy("Times are shown in your timezone.")}</p>
        <div className="flex items-center gap-1.5">
          <span>{copy("Lower")}</span>
          {[0.22, 0.48, 0.74, 1].map((opacity) => (
            <span key={opacity} className="size-3 rounded-sm bg-primary" style={{ opacity }} aria-hidden />
          ))}
          <span>{copy("Higher")}</span>
        </div>
      </div>
    </>
  );
}
