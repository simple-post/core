import { useState } from "react";

import { format } from "date-fns";

import { ScheduleCalendarView, type CalendarView, type DayEntry } from "@/components/visual/schedule-calendar";
import { addDays, addMonths, dayKey, getCalendarRange, getPeriodLabel } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";

import type { Workspace } from "./types";

export function PlannerCalendar({
  workspace,
  open,
  create,
}: {
  workspace: Workspace;
  open: (id: string) => void;
  create?: (day: Date) => void;
}) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(new Date());
  const now = new Date();
  const range = getCalendarRange(view, anchor);
  const entries = new Map<string, DayEntry[]>();
  for (const post of workspace.posts) {
    const time = new Date(post.plannedAt);
    if (time < range.fetchStart || time >= range.fetchEnd) continue;
    const state = workspace.states.find((s) => s.id === post.stateId);
    const owner = workspace.members.find((m) => m.userId === post.ownerId)?.user.name ?? "Unassigned";
    const due = post.dueAt ? new Date(post.dueAt) : null;
    const overdue = due && due < now && state?.kind !== "approved";
    const key = dayKey(time);
    const day = entries.get(key) ?? [];
    day.push({
      key: post.id,
      time,
      isSlot: false,
      posts: [
        {
          id: post.id,
          message: post.title,
          status: post.deliveredAt && post.variants.every((v) => !v.accountId) ? "published" : "planned",
          platforms: post.variants.map((v) => v.platform),
          details: (
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
              <span className="block truncate text-foreground">{state?.name}</span>
              <span className="block truncate">{owner}</span>
              {due && (
                <span className={cn("block", overdue && "text-destructive")}>
                  {overdue ? "Overdue" : "Due"} {format(due, "MMM d")}
                </span>
              )}
            </span>
          ),
        },
      ],
    });
    entries.set(key, day);
  }
  for (const day of entries.values()) day.sort((a, b) => a.time.getTime() - b.time.getTime());
  return (
    <section aria-label="Editorial calendar">
      <ScheduleCalendarView
        view={view}
        periodLabel={getPeriodLabel(view, range)}
        range={range}
        anchorDate={anchor}
        now={now}
        entriesByDay={entries}
        setView={setView}
        setAnchorDate={setAnchor}
        move={(direction) =>
          setAnchor(
            view === "month" ? addMonths(anchor, direction) : addDays(anchor, direction * (view === "week" ? 7 : 1)),
          )
        }
        onToday={() => setAnchor(new Date())}
        allowCreate={!!create}
        renderAction={({ target, className, ...props }) => (
          <button
            {...props}
            type="button"
            className={cn(className, target.kind === "post" && "w-full text-start")}
            onClick={() => {
              if (target.kind === "post") open(target.id);
              else if (target.kind === "create") create?.(anchor);
            }}
          />
        )}
      />
    </section>
  );
}
