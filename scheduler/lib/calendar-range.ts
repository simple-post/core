import { format } from "date-fns";

import type { CalendarView } from "@/components/visual/schedule-calendar";

interface CalendarRange {
  fetchStart: Date;
  fetchEnd: Date;
  periodStart: Date;
  periodEnd: Date;
  days: Date[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let cursor = new Date(start); cursor < end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

// Monday-first month grid covering the visible month in full weeks.
function getMonthGridRange(date: Date): { gridStart: Date; gridEnd: Date } {
  const monthStart = startOfMonth(date);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = addMonths(monthStart, 1);
  const gridEnd = startOfWeek(addDays(monthEnd, 6));
  return { gridStart, gridEnd };
}

export function getCalendarRange(view: CalendarView, anchorDate: Date): CalendarRange {
  if (view === "month") {
    const periodStart = startOfMonth(anchorDate);
    const periodEnd = addMonths(periodStart, 1);
    const { gridStart, gridEnd } = getMonthGridRange(anchorDate);
    return {
      fetchStart: gridStart,
      fetchEnd: gridEnd,
      periodStart,
      periodEnd,
      days: getDaysInRange(gridStart, gridEnd),
    };
  }

  const periodStart = view === "week" ? startOfWeek(anchorDate) : startOfDay(anchorDate);
  const periodEnd = addDays(periodStart, view === "week" ? 7 : 1);
  return {
    fetchStart: periodStart,
    fetchEnd: periodEnd,
    periodStart,
    periodEnd,
    days: getDaysInRange(periodStart, periodEnd),
  };
}

export function getPeriodLabel(view: CalendarView, range: CalendarRange): string {
  if (view === "month") return format(range.periodStart, "MMMM yyyy");
  if (view === "day") return format(range.periodStart, "EEEE, MMMM d, yyyy");

  const lastDay = addDays(range.periodEnd, -1);
  if (range.periodStart.getMonth() === lastDay.getMonth()) {
    return `${format(range.periodStart, "MMM d")}–${format(lastDay, "d, yyyy")}`;
  }
  if (range.periodStart.getFullYear() === lastDay.getFullYear()) {
    return `${format(range.periodStart, "MMM d")} – ${format(lastDay, "MMM d, yyyy")}`;
  }
  return `${format(range.periodStart, "MMM d, yyyy")} – ${format(lastDay, "MMM d, yyyy")}`;
}

export function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}
