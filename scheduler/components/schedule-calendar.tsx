"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { HelpLink } from "@/components/help-link";
import { useScheduleCalendarState } from "@/components/schedule-calendar-context";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { usePostingSlots } from "@/hooks/use-posting-slots";
import { useCalendarPosts } from "@/hooks/use-posts";
import { addDays, addMonths, dayKey, getCalendarRange, getPeriodLabel } from "@/lib/calendar-range";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { getSlotOccurrencesInRange, slotOccurrenceKey } from "@/lib/posting-slots/occurrences";

import { ScheduleCalendarView, type CalendarActionProps, type DayEntry } from "./visual/schedule-calendar";

/**
 * Responsive calendar for posting slots and scheduled posts. Week is the
 * default view; month and week use grids on larger screens and switch to
 * touch-friendly agendas on mobile.
 */
export function ScheduleCalendar() {
  const { copy } = useUiCopy();
  const readOnly = useWorkspaceReadOnly();
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
      showEmptySlots={!readOnly && !slotsLoading && slots.length === 0}
      slotHint={readOnly ? copy("Saved posts appear here") : undefined}
      help={
        <HelpLink path="/scheduling" className="mb-3">
          {copy("Calendar, timezones, and posting slots")}{" "}
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
  const readOnly = useWorkspaceReadOnly();
  if (readOnly && target.kind !== "post") return null;
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
