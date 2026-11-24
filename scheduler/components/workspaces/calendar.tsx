import { useScheduleCalendarState } from "@/components/schedule-calendar-context";
import { ScheduleCalendarView, type DayEntry } from "@/components/visual/schedule-calendar";
import { addDays, addMonths, dayKey, getCalendarRange, getPeriodLabel } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";

import { deliveryStatus, type Workspace } from "./types";

export function PlannerCalendar({
  workspace,
  open,
  create,
}: {
  workspace: Workspace;
  open: (id: string) => void;
  create?: (day: Date) => void;
}) {
  const { view, setView, anchorDate: anchor, setAnchorDate: setAnchor } = useScheduleCalendarState();
  const now = new Date();
  const range = getCalendarRange(view, anchor);
  const entries = new Map<string, DayEntry[]>();
  for (const post of workspace.posts) {
    const time = new Date(post.plannedAt);
    if (time < range.fetchStart || time >= range.fetchEnd) continue;
    const state = workspace.states.find((s) => s.id === post.stateId);
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
          status: deliveryStatus(post),
          platforms: post.variants.map((v) => v.platform),
          details: state && <span className="block truncate text-[10px] text-muted-foreground">{state.name}</span>,
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
              else if (target.kind === "create") create?.(target.day ?? anchor);
            }}
          />
        )}
      />
    </section>
  );
}
