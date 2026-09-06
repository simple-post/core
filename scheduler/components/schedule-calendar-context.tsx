"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type CalendarView = "month" | "week" | "day";

interface ScheduleCalendarState {
  view: CalendarView;
  setView: Dispatch<SetStateAction<CalendarView>>;
  anchorDate: Date;
  setAnchorDate: Dispatch<SetStateAction<Date>>;
}

const ScheduleCalendarContext = createContext<ScheduleCalendarState | null>(null);

// The protected layout survives client navigation, keeping the calendar's
// position until the page is refreshed or the signed-in user changes.
export function ScheduleCalendarProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  return (
    <ScheduleCalendarContext.Provider value={{ view, setView, anchorDate, setAnchorDate }}>
      {children}
    </ScheduleCalendarContext.Provider>
  );
}

export function useScheduleCalendarState() {
  const context = useContext(ScheduleCalendarContext);
  if (!context) {
    throw new Error("useScheduleCalendarState must be used within ScheduleCalendarProvider");
  }
  return context;
}
