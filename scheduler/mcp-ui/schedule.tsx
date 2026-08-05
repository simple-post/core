import { useMemo, useState } from "react";

import { createRoot } from "react-dom/client";

import { useMcpToolData } from "./use-mcp-tool-data";

import type { App } from "@modelcontextprotocol/ext-apps";

import "./schedule.css";

type ScheduleView = "day" | "week" | "month";
type ScheduleStatus = "open" | "scheduled" | "pending" | "published" | "failed" | "past_due";

type ScheduleEntry = {
  id: string;
  kind: "slot" | "post";
  at: string;
  localTime: string;
  isPast: boolean;
  postId: string | null;
  message: string | null;
  status: ScheduleStatus;
  platforms: string[];
  errorMessage: string | null;
};

type ScheduleDay = {
  date: string;
  weekday: string;
  weekdayShort: string;
  dayNumber: number;
  inPeriod: boolean;
  isToday: boolean;
  entries: ScheduleEntry[];
};

type ScheduleData = {
  kind: "schedule";
  view: ScheduleView;
  anchorDate: string;
  previousAnchorDate: string;
  nextAnchorDate: string;
  todayAnchorDate: string;
  timeZone: string;
  periodLabel: string;
  rangeStart: string;
  rangeEnd: string;
  days: ScheduleDay[];
  summary: {
    openSlotCount: number;
    scheduledCount: number;
    publishedCount: number;
    failedCount: number;
    pastCount: number;
  };
};

const VIEW_OPTIONS: Array<{ value: ScheduleView; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function textFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadSchedule(
  app: App,
  input: { view: ScheduleView; date: string; timeZone: string },
): Promise<ScheduleData> {
  const result = await app.callServerTool({
    name: "get_schedule",
    arguments: input,
  });
  if (result.isError || !result.structuredContent) {
    const text = result.content.find((item) => item.type === "text");
    throw new Error(text?.type === "text" ? text.text : "Couldn't load the schedule.");
  }
  return result.structuredContent as ScheduleData;
}

function Summary({ data }: { data: ScheduleData }) {
  const items = [
    { label: "open", value: data.summary.openSlotCount, tone: "open" },
    { label: "scheduled", value: data.summary.scheduledCount, tone: "scheduled" },
    { label: "published", value: data.summary.publishedCount, tone: "published" },
    { label: "failed", value: data.summary.failedCount, tone: "failed" },
  ];
  return (
    <div className="summary" aria-label="Schedule summary">
      {items.map((item) => (
        <span className="summary-item" key={item.label}>
          <span className={`summary-dot ${item.tone}`} />
          <strong>{item.value}</strong> {item.label}
        </span>
      ))}
    </div>
  );
}

function Entry({ entry, compact = false }: { entry: ScheduleEntry; compact?: boolean }) {
  const statusLabel =
    entry.status === "open"
      ? entry.isPast
        ? "Unused slot"
        : "Open slot"
      : entry.status === "past_due"
        ? "Past due"
        : entry.status === "pending"
          ? "Publishing"
          : entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
  return (
    <article
      className={`entry status-${entry.status} ${entry.isPast ? "is-past" : ""} ${compact ? "compact" : ""}`}
      title={entry.message ?? statusLabel}>
      <div className="entry-topline">
        <time>{entry.localTime}</time>
        <span className="entry-status">{statusLabel}</span>
      </div>
      {entry.message ? <p>{entry.message}</p> : null}
      {!compact && entry.platforms.length > 0 ? (
        <div className="platforms" aria-label="Platforms">
          {entry.platforms.map((platform) => (
            <span key={platform}>{platform}</span>
          ))}
        </div>
      ) : null}
      {!compact && entry.errorMessage ? <div className="entry-error">{entry.errorMessage}</div> : null}
    </article>
  );
}

function DayAgenda({ day }: { day: ScheduleDay }) {
  return (
    <section className="day-agenda">
      <header className="day-agenda-header">
        <span className={day.isToday ? "date-tile today" : "date-tile"}>
          <small>{day.weekdayShort}</small>
          <strong>{day.dayNumber}</strong>
        </span>
        <div>
          <h3>{day.isToday ? "Today" : day.weekday}</h3>
          <p>{day.date}</p>
        </div>
      </header>
      <div className="agenda-list">
        {day.entries.length > 0 ? (
          day.entries.map((entry) => <Entry key={entry.id} entry={entry} />)
        ) : (
          <div className="empty-day">Nothing planned</div>
        )}
      </div>
    </section>
  );
}

function WeekView({ days }: { days: ScheduleDay[] }) {
  return (
    <div className="week-grid">
      {days.map((day) => (
        <section className={day.isToday ? "week-day today" : "week-day"} key={day.date}>
          <header>
            <span>{day.weekdayShort}</span>
            <strong>{day.dayNumber}</strong>
          </header>
          <div className="week-entries">
            {day.entries.length > 0 ? (
              day.entries.map((entry) => <Entry key={entry.id} entry={entry} compact />)
            ) : (
              <span className="no-activity">No activity</span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function MonthView({ days }: { days: ScheduleDay[] }) {
  const weekdays = days.slice(0, 7).map((day) => day.weekdayShort);
  return (
    <div className="month-shell">
      <div className="month-weekdays">
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((day) => (
          <section
            className={`${day.inPeriod ? "month-day" : "month-day outside"} ${day.isToday ? "today" : ""}`}
            key={day.date}>
            <header>
              <strong>{day.dayNumber}</strong>
            </header>
            <div className="month-entries">
              {day.entries.slice(0, 3).map((entry) => (
                <Entry key={entry.id} entry={entry} compact />
              ))}
              {day.entries.length > 3 ? <span className="more">+{day.entries.length - 3} more</span> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ScheduleApp() {
  const { app, data, setData, isConnected, error, toolError, setToolError } =
    useMcpToolData<ScheduleData>("SimplePost Schedule");
  const [loading, setLoading] = useState(false);

  const activeDay = useMemo(() => {
    if (!data) return null;
    return data.days.find((day) => day.date === data.anchorDate) ?? data.days.find((day) => day.inPeriod) ?? null;
  }, [data]);

  async function navigate(view: ScheduleView, date: string) {
    if (!app || !data) return;
    setLoading(true);
    setToolError(null);
    try {
      setData(await loadSchedule(app, { view, date, timeZone: data.timeZone }));
    } catch (nextError) {
      setToolError(textFromError(nextError));
    } finally {
      setLoading(false);
    }
  }

  if (error || toolError) {
    return <div className="state-card error-card">{error?.message ?? toolError}</div>;
  }
  if (!isConnected || !data) {
    return <div className="state-card">Loading your schedule…</div>;
  }

  return (
    <main className={loading ? "schedule-app is-loading" : "schedule-app"}>
      <header className="toolbar">
        <div className="brand-lockup">
          <span className="brand-mark" />
          <div>
            <span className="eyebrow">SimplePost schedule</span>
            <h1>{data.periodLabel}</h1>
          </div>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={`Previous ${data.view}`}
            onClick={() => navigate(data.view, data.previousAnchorDate)}>
            ←
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={`Next ${data.view}`}
            onClick={() => navigate(data.view, data.nextAnchorDate)}>
            →
          </button>
          <button className="today-button" type="button" onClick={() => navigate(data.view, data.todayAnchorDate)}>
            Today
          </button>
          {app ? (
            <button
              className="expand-button"
              type="button"
              onClick={() => app.requestDisplayMode({ mode: "fullscreen" })}>
              Expand
            </button>
          ) : null}
        </div>
      </header>

      <div className="view-row">
        <Summary data={data} />
        <div className="view-switcher" role="tablist" aria-label="Schedule view">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={data.view === option.value}
              onClick={() => navigate(option.value, data.anchorDate)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="calendar-frame" aria-busy={loading}>
        {data.view === "month" ? (
          <MonthView days={data.days} />
        ) : data.view === "week" ? (
          <WeekView days={data.days} />
        ) : activeDay ? (
          <DayAgenda day={activeDay} />
        ) : null}
      </section>

      <footer>
        <span>{data.timeZone}</span>
        {data.summary.pastCount > 0 ? <span>{data.summary.pastCount} past items shown</span> : null}
      </footer>
    </main>
  );
}

export function mountScheduleWidget() {
  const rootElement = document.querySelector("#root");
  if (!rootElement) throw new Error("SimplePost schedule root element is missing.");
  createRoot(rootElement).render(<ScheduleApp />);
}
