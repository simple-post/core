import { useState } from "react";

import { createRoot } from "react-dom/client";

import { Button } from "../components/ui/button";

import { Calendar } from "./extensions/calendar";
import { useMcpToolData } from "./use-mcp-tool-data";

import type { App } from "@modelcontextprotocol/ext-apps";

import "./extensions/design-system.css";
import "./extensions/workspace.css";

export type ScheduleView = "day" | "week" | "month";
type ScheduleStatus = "open" | "scheduled" | "pending" | "published" | "failed" | "past_due";

export type ScheduleEntry = {
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

export type ScheduleDay = {
  date: string;
  weekday: string;
  weekdayShort: string;
  dayNumber: number;
  inPeriod: boolean;
  isToday: boolean;
  entries: ScheduleEntry[];
};

export type ScheduleData = {
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

function ScheduleApp() {
  const { app, data, setData, isConnected, error, toolError, setToolError } =
    useMcpToolData<ScheduleData>("SimplePost Schedule");
  const [loading, setLoading] = useState(false);

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
    <main className="sp-workspace" aria-busy={loading}>
      <header className="sp-header">
        <div>
          <span className="sp-mark">SP</span>
          <strong>SimplePost</strong>
        </div>
        <Button variant="outline" size="sm" onClick={() => void app?.requestDisplayMode({ mode: "fullscreen" })}>
          Expand
        </Button>
      </header>
      <Calendar
        data={data}
        busy={loading}
        onNavigate={(input) =>
          void navigate((input.view as ScheduleView) ?? data.view, (input.date as string) ?? data.anchorDate)
        }
      />
      {data.summary.pastCount > 0 ? (
        <p className="text-xs text-muted-foreground mt-3">{data.summary.pastCount} past items shown</p>
      ) : null}
    </main>
  );
}

export function mountScheduleWidget() {
  const rootElement = document.querySelector("#root");
  if (!rootElement) throw new Error("SimplePost schedule root element is missing.");
  createRoot(rootElement).render(<ScheduleApp />);
}
