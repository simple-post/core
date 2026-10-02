import { useState } from "react";

import { format } from "date-fns";
import { CalendarDays, Settings2 } from "lucide-react";

import { PlatformIconBadge } from "../../components/platform-icons";
import { Button } from "../../components/ui/button";
import {
  ScheduleCalendarView,
  type CalendarActionProps,
  type DayEntry,
} from "../../components/visual/schedule-calendar";

import { localDateTime } from "./timezone";

import type { ScheduleData, ScheduleEntry } from "../schedule";
export function PlatformBadge({ platform }: { platform: string }) {
  return <PlatformIconBadge platform={platform} />;
}
export function Calendar({
  data,
  busy,
  selectedId,
  onSelect,
  onNavigate,
  onSettings,
  onCreate,
}: {
  data: ScheduleData;
  busy: boolean;
  selectedId?: string;
  onSelect?: (entry: ScheduleEntry) => void;
  onNavigate: (input: Record<string, unknown>) => void;
  onSettings?: () => void;
  onCreate?: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const entriesByDay = new Map<string, DayEntry[]>();
  const entries = new Map<string, ScheduleEntry>();
  for (const day of data.days) {
    entriesByDay.set(
      day.date,
      day.entries.map((entry) => {
        entries.set(entry.id, entry);
        if (entry.postId) entries.set(entry.postId, entry);
        return {
          key: entry.id,
          // localTime is a display label (for example "5:00 PM"), not an ISO
          // time. Project the actual instant into the workspace's timezone for
          // the shared calendar, independently of the browser's timezone.
          time: new Date(localDateTime(new Date(entry.at), data.timeZone)),
          timeLabel: entry.localTime,
          isPast: entry.isPast,
          isSlot: entry.kind === "slot",
          posts:
            entry.kind === "post"
              ? [
                  {
                    id: entry.postId ?? entry.id,
                    message: entry.message ?? "",
                    status: entry.status,
                    platforms: entry.platforms,
                    errorMessage: entry.errorMessage,
                  },
                ]
              : [],
        };
      }),
    );
  }
  const date = (value: string) => new Date(`${value}T12:00:00`);
  const Action = ({ target, children, className, title }: CalendarActionProps) => {
    const entry = "id" in target ? entries.get(target.id) : undefined;
    if (entry && !onSelect)
      return (
        <div className={className} title={title}>
          {children}
        </div>
      );
    if (target.kind === "create" && !onCreate) return null;
    return (
      <button
        type="button"
        disabled={busy}
        title={title}
        className={`${className ?? ""} w-full text-left ${entry?.id === selectedId ? "ring-2 ring-primary" : ""}`}
        aria-pressed={entry ? entry.id === selectedId : undefined}
        onClick={() => {
          if (entry) onSelect?.(entry);
          else if (target.kind === "settings") onSettings?.();
          else if (target.kind === "create") onCreate?.();
        }}>
        {children}
      </button>
    );
  };
  const days = data.view === "day" ? data.days.filter((day) => day.date === data.anchorDate) : data.days;
  return (
    <section aria-label="Publishing calendar" className="simplepost-visual space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays size={18} /> Calendar
        </h2>
        {onSettings ? (
          <Button variant="ghost" size="icon" aria-label="Manage recurring slots" onClick={onSettings}>
            <Settings2 size={16} />
          </Button>
        ) : null}
      </div>
      <fieldset disabled={busy} className="min-w-0">
        <ScheduleCalendarView
          view={data.view}
          periodLabel={data.periodLabel}
          range={{ days: days.map((day) => date(day.date)), periodStart: date(data.anchorDate) }}
          anchorDate={date(selectedDay && days.some((day) => day.date === selectedDay) ? selectedDay : data.anchorDate)}
          now={date(data.todayAnchorDate)}
          entriesByDay={entriesByDay}
          summary={{
            open: data.summary.openSlotCount,
            scheduled: data.summary.scheduledCount,
            posted: data.summary.publishedCount,
            failed: data.summary.failedCount,
          }}
          help={<span className="block mb-3 text-xs text-muted-foreground">{data.timeZone}</span>}
          setAnchorDate={(day) => setSelectedDay(format(day, "yyyy-MM-dd"))}
          setView={(view) => onNavigate({ view })}
          onOpenDay={(day) => onNavigate({ view: "day", date: format(day, "yyyy-MM-dd") })}
          move={(direction) => onNavigate({ date: direction < 0 ? data.previousAnchorDate : data.nextAnchorDate })}
          onToday={() => onNavigate({ date: data.todayAnchorDate })}
          renderAction={Action}
          slotHint={onSelect ? "Select this time to plan a post with ChatGPT" : "Available for a new post"}
        />
      </fieldset>
    </section>
  );
}
