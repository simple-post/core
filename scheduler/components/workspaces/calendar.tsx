import { useState } from "react";

import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock3 } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icon";

import { platformName, type Item, type Workspace } from "./types";

export function PlannerCalendar({ workspace: w, open }: { workspace: Workspace; open: (post: Item) => void }) {
  const [view, setView] = useState<"Week" | "Month">("Week");
  const [anchor, setAnchor] = useState(new Date());
  const start = startOfWeek(view === "Week" ? anchor : startOfMonth(anchor), { weekStartsOn: 1 });
  const end = view === "Week" ? addDays(start, 6) : endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const shift = (n: number) => setAnchor(view === "Week" ? addDays(anchor, n * 7) : addMonths(anchor, n));
  return (
    <section aria-label="Editorial calendar">
      <div className="tw-toolbar">
        <div className="tw-line">
          <h2>
            {view === "Month"
              ? format(anchor, "MMMM yyyy")
              : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`}
          </h2>
          <button aria-label="Previous period" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Next period" onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setAnchor(new Date())}>Today</button>
        </div>
        <div className="tw-segment">
          {(["Week", "Month"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="tw-calendar-scroll">
        <div className={`tw-calendar ${view.toLowerCase()}`}>
          {days.slice(0, 7).map((d) => (
            <div key={d.toISOString()} className="tw-dayname">
              {format(d, "EEEE")}
            </div>
          ))}
          {days.map((day) => (
            <div
              className={`tw-day ${view === "Week" || isSameMonth(day, anchor) ? "" : "outside"}`}
              key={day.toISOString()}>
              <span className={isSameDay(day, new Date()) ? "today" : ""}>{format(day, "d")}</span>
              {w.posts
                .filter((p) => isSameDay(new Date(p.plannedAt), day))
                .map((p) => {
                  const state = w.states.find((s) => s.id === p.stateId)!;
                  const owner = w.members.find((m) => m.userId === p.ownerId)?.user.name;
                  const late = p.dueAt && new Date(p.dueAt) < new Date() && state.kind !== "approved";
                  return (
                    <button key={p.id} className="tw-card" data-kind={state.kind} onClick={() => open(p)}>
                      <span className="tw-card-top">
                        {p.variants.map((v) => (
                          <span key={v.platform} title={platformName[v.platform]}>
                            <PlatformIcon platform={v.platform} />
                          </span>
                        ))}
                        <time>{format(new Date(p.plannedAt), "HH:mm")}</time>
                      </span>
                      <strong>{p.title}</strong>
                      <span className="tw-state" data-kind={state.kind}>
                        {state.name}
                      </span>
                      <small>{owner ?? "Unassigned"}</small>
                      {p.dueAt && (
                        <small className={late ? "tw-late" : ""}>
                          <Clock3 size={11} /> {late ? "Overdue" : "Due"} {format(new Date(p.dueAt), "MMM d")}
                        </small>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
