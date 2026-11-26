"use client";

import { useState } from "react";

import type { AnalyticsSummary } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

import { formatNumber } from "../format";

const MIN_POSTS = 2;

export function BestTimes({ bestTimes }: { bestTimes: AnalyticsSummary["bestTimes"] }) {
  const { copy, locale } = useUiCopy();
  const [activeSlot, setActiveSlot] = useState<{ weekday: number; hour: number }>();
  const slots = bestTimes.bySlot;
  const peak = Math.max(
    1,
    ...slots.filter((slot) => slot.posts >= MIN_POSTS).map((slot) => slot.averageEngagements ?? 0),
  );
  const weekdayName = (weekday: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + weekday)),
    );
  const hourName = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1, hour)));

  const slotLabel = (slot: (typeof slots)[number]) =>
    slot.averageEngagements === null
      ? copy("No data")
      : `${formatNumber(slot.averageEngagements, locale)} · ${copy("Based on {{count, number}} posts", { count: slot.posts })}`;
  const selected = activeSlot && slots[activeSlot.weekday * 24 + activeSlot.hour];

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
                  const label = slotLabel(slots[weekday * 24 + hour]);
                  const description = `${weekdayName(weekday)} · ${hourName(hour)} · ${label}`;
                  return (
                    <td key={hour} className="h-5 rounded-sm bg-muted/60 p-0">
                      {averageEngagements === null ? (
                        <span className="sr-only">{label}</span>
                      ) : (
                        <button
                          type="button"
                          aria-label={description}
                          aria-pressed={activeSlot?.weekday === weekday && activeSlot.hour === hour}
                          title={description}
                          onClick={() => setActiveSlot({ weekday, hour })}
                          className={cn(
                            "block h-5 w-full rounded-sm bg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                            activeSlot?.weekday === weekday &&
                              activeSlot.hour === hour &&
                              "ring-2 ring-inset ring-foreground",
                          )}
                          style={{
                            backgroundColor: `color-mix(in oklab, var(--primary) ${posts < MIN_POSTS ? 14 : 22 + 78 * (averageEngagements / peak)}%, transparent)`,
                          }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p aria-live="polite">
          {activeSlot && selected
            ? `${weekdayName(activeSlot.weekday)} · ${hourName(activeSlot.hour)} · ${slotLabel(selected)}`
            : copy("Times are shown in your timezone.")}
        </p>
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
