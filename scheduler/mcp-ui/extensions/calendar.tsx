import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";

import { PlatformIcon } from "../../components/platform-icon";

import type { ScheduleData, ScheduleEntry } from "../schedule";

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className={`sp-platform-badge platform-${platform}`} title={platform}>
      <PlatformIcon platform={platform} className="sp-platform-icon" />
      <span className="sp-sr-only">{platform}</span>
    </span>
  );
}

export function Calendar({
  data,
  busy,
  selectedId,
  onSelect,
  onNavigate,
  onSettings,
}: {
  data: ScheduleData;
  busy: boolean;
  selectedId?: string;
  onSelect: (entry: ScheduleEntry) => void;
  onNavigate: (input: Record<string, unknown>) => void;
  onSettings: () => void;
}) {
  const days = data.view === "day" ? data.days.filter((day) => day.date === data.anchorDate) : data.days;
  return (
    <section className="sp-calendar-section" aria-label="Publishing calendar">
      <div className="sp-section-heading">
        <h2>
          <CalendarDays size={18} /> Calendar
        </h2>
        <button className="sp-icon-button" aria-label="Manage recurring slots" onClick={onSettings}>
          <Settings2 size={16} />
        </button>
      </div>
      <div className="sp-calendar">
        <div className="sp-calendar-toolbar">
          <div className="sp-calendar-period">
            <button
              aria-label="Previous period"
              disabled={busy}
              onClick={() => onNavigate({ date: data.previousAnchorDate })}>
              <ChevronLeft size={16} />
            </button>
            <button aria-label="Next period" disabled={busy} onClick={() => onNavigate({ date: data.nextAnchorDate })}>
              <ChevronRight size={16} />
            </button>
            <h3>{data.periodLabel}</h3>
            <button disabled={busy} onClick={() => onNavigate({ date: data.todayAnchorDate })}>
              Today
            </button>
          </div>
          <div className="sp-view-switch" aria-label="Calendar view">
            {(["month", "week", "day"] as const).map((view) => (
              <button key={view} disabled={busy} aria-pressed={data.view === view} onClick={() => onNavigate({ view })}>
                {view[0].toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="sp-calendar-summary">
          <div className="sp-legend">
            <span>
              <i className="open" />
              {data.summary.openSlotCount} open
            </span>
            <span>
              <i className="scheduled" />
              {data.summary.scheduledCount} scheduled
            </span>
            <span>
              <i className="published" />
              {data.summary.publishedCount} posted
            </span>
            {data.summary.failedCount > 0 ? (
              <span>
                <i className="failed" />
                {data.summary.failedCount} failed
              </span>
            ) : null}
          </div>
          <span>{data.timeZone}</span>
        </div>
        <div className={`sp-calendar-grid sp-calendar-view-${data.view}`}>
          {days.map((day) => (
            <div
              key={day.date}
              className={`sp-calendar-day${day.isToday ? " is-today" : ""}${day.inPeriod ? "" : " is-outside"}`}>
              <button
                className="sp-day-heading"
                aria-label={`Open ${day.weekday}, ${day.date} in day view`}
                disabled={busy}
                onClick={() => onNavigate({ view: "day", date: day.date })}>
                <span>{day.weekdayShort}</span>
                <strong>{day.dayNumber}</strong>
              </button>
              <div className="sp-day-entries">
                {day.entries.length > 0 ? (
                  (data.view === "month" ? day.entries.slice(0, 3) : day.entries).map((entry) => (
                    <button
                      key={entry.id}
                      className={`sp-calendar-entry status-${entry.status}${selectedId === entry.id ? " is-selected" : ""}`}
                      aria-pressed={selectedId === entry.id}
                      onClick={() => onSelect(entry)}>
                      <span className="sp-entry-time">
                        {entry.kind === "slot" ? <Plus size={12} /> : <i />}
                        {entry.localTime}
                        <span className="sp-entry-platforms">
                          {entry.platforms.map((platform) => (
                            <PlatformBadge key={platform} platform={platform} />
                          ))}
                        </span>
                      </span>
                      <span className="sp-entry-message">
                        {entry.message || (entry.isPast ? "Unused slot" : "Open slot")}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="sp-no-activity">No activity</p>
                )}
                {data.view === "month" && day.entries.length > 3 ? (
                  <button
                    className="sp-more-entries"
                    disabled={busy}
                    onClick={() => onNavigate({ view: "day", date: day.date })}>
                    +{day.entries.length - 3} more
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
