"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { format } from "date-fns";

import { HelpLink } from "@/components/help-link";
import { useScheduleCalendarState, type CalendarView } from "@/components/schedule-calendar-context";
import { usePostingSlots } from "@/hooks/use-posting-slots";
import { useCalendarPosts } from "@/hooks/use-posts";
import { getSlotOccurrencesInRange, slotOccurrenceKey } from "@/lib/posting-slots/occurrences";

import { ScheduleCalendarView, type CalendarActionProps, type DayEntry } from "./visual/schedule-calendar";

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

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
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

function getCalendarRange(view: CalendarView, anchorDate: Date): CalendarRange {
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

function getPeriodLabel(view: CalendarView, range: CalendarRange): string {
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

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Responsive calendar for posting slots and scheduled posts. Week is the
 * default view; month and week use grids on larger screens and switch to
 * touch-friendly agendas on mobile.
 */
export function ScheduleCalendar() {
  const { view, setView, anchorDate, setAnchorDate } = useScheduleCalendarState();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const range = useMemo(() => getCalendarRange(view, anchorDate), [anchorDate, view]);
  const { data: slots = [], isLoading: slotsLoading } = usePostingSlots();
  const { data: posts, isLoading: postsLoading } = useCalendarPosts(range.fetchStart, range.fetchEnd);

  const entriesByDay = useMemo(() => {
    const byDay = new Map<string, DayEntry[]>();
    const entryByKey = new Map<string, DayEntry>();

    const addEntry = (entry: DayEntry) => {
      entryByKey.set(entry.key, entry);
      const key = dayKey(entry.time);
      const dayEntries = byDay.get(key) ?? [];
      dayEntries.push(entry);
      byDay.set(key, dayEntries);
    };

    for (const occurrence of getSlotOccurrencesInRange(slots, range.fetchStart, range.fetchEnd)) {
      addEntry({ key: slotOccurrenceKey(occurrence), time: occurrence, isSlot: true, posts: [] });
    }

    for (const post of posts ?? []) {
      if (!post.scheduledFor) continue;

      const key = slotOccurrenceKey(post.scheduledFor);
      const existing = entryByKey.get(key);
      if (existing) {
        existing.posts.push(post);
      } else {
        addEntry({ key, time: post.scheduledFor, isSlot: false, posts: [post] });
      }
    }

    for (const dayEntries of byDay.values()) {
      dayEntries.sort((left, right) => left.time.getTime() - right.time.getTime());
    }
    return byDay;
  }, [posts, range.fetchEnd, range.fetchStart, slots]);

  const summary = useMemo(() => {
    let open = 0;
    let scheduled = 0;
    let posted = 0;

    for (const entries of entriesByDay.values()) {
      for (const entry of entries) {
        if (entry.time < range.periodStart || entry.time >= range.periodEnd) continue;
        if (entry.isSlot && entry.posts.length === 0 && entry.time > now) open += 1;
        scheduled += entry.posts.filter((post) => post.status === "scheduled" || post.status === "pending").length;
        posted += entry.posts.filter((post) => post.status === "published").length;
      }
    }

    return { open, scheduled, posted };
  }, [entriesByDay, now, range.periodEnd, range.periodStart]);

  const move = (direction: -1 | 1) => {
    setAnchorDate((current) => {
      if (view === "month") return addMonths(current, direction);
      return addDays(current, direction * (view === "week" ? 7 : 1));
    });
  };

  const isLoading = slotsLoading || postsLoading;
  const periodLabel = getPeriodLabel(view, range);

  return (
    <ScheduleCalendarView
      view={view}
      periodLabel={periodLabel}
      range={range}
      anchorDate={anchorDate}
      now={now}
      entriesByDay={entriesByDay}
      summary={summary}
      isLoading={isLoading}
      showEmptySlots={!slotsLoading && slots.length === 0}
      help={
        <HelpLink path="/scheduling" className="mb-3">
          Calendar, timezones, and posting slots
        </HelpLink>
      }
      setAnchorDate={setAnchorDate}
      setView={setView}
      move={move}
      onToday={() => setAnchorDate(new Date())}
      renderAction={CalendarLink}
    />
  );
}
function CalendarLink({ target, ...props }: CalendarActionProps) {
  const href =
    target.kind === "post"
      ? `/posts/${target.id}`
      : target.kind === "slot"
        ? `/schedule?slot=${target.id}`
        : target.kind === "settings"
          ? "/settings"
          : "/schedule";
  return <Link href={href} {...props} />;
}
