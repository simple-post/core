"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { format } from "date-fns";
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePostingSlots } from "@/hooks/use-posting-slots";
import { useCalendarPosts } from "@/hooks/use-posts";
import { WEEKDAYS, getSlotOccurrencesInRange, slotOccurrenceKey } from "@/lib/posting-slots/occurrences";
import { cn } from "@/lib/utils";
import type { SocialPost } from "@/types";

interface DayEntry {
  key: string; // slot occurrence / post minute key
  time: Date;
  isSlot: boolean; // falls on a configured posting slot
  posts: SocialPost[]; // every post scheduled at this exact minute
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

// Monday-first calendar grid covering the whole month, in full weeks.
function getGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date } {
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));

  const gridEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  if (gridEnd.getDay() !== 1) {
    gridEnd.setDate(gridEnd.getDate() + ((8 - gridEnd.getDay()) % 7));
  }

  return { gridStart, gridEnd };
}

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Month calendar of posting slots and scheduled posts. Open future slots link
 * straight to the create-post form prefilled with that slot's time; posts link
 * to their detail page.
 */
export function ScheduleCalendar() {
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const { gridStart, gridEnd } = useMemo(() => getGridRange(monthStart), [monthStart]);
  const { data: slots = [], isLoading: slotsLoading } = usePostingSlots();
  const { data: posts, isLoading: postsLoading } = useCalendarPosts(gridStart, gridEnd);

  const days = useMemo(() => {
    const result: Date[] = [];
    const cursor = new Date(gridStart);
    while (cursor < gridEnd) {
      result.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [gridStart, gridEnd]);

  // Slot occurrences and posts merged into per-day, time-sorted entries.
  // Posts scheduled at the same minute share one entry (rendered with a +N
  // badge); a post at a slot time fills that slot, other posts show as
  // regular entries.
  const entriesByDay = useMemo(() => {
    const byDay = new Map<string, DayEntry[]>();
    const entryByKey = new Map<string, DayEntry>();

    const addEntry = (entry: DayEntry) => {
      entryByKey.set(entry.key, entry);
      const day = dayKey(entry.time);
      const dayEntries = byDay.get(day) ?? [];
      dayEntries.push(entry);
      byDay.set(day, dayEntries);
    };

    for (const occurrence of getSlotOccurrencesInRange(slots, gridStart, gridEnd)) {
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
      dayEntries.sort((a, b) => a.time.getTime() - b.time.getTime());
    }
    return byDay;
  }, [gridStart, gridEnd, posts, slots]);

  // Month-only slot stats shown next to the legend: how many slots already
  // have a post and how many are still open (future, unfilled).
  const summary = useMemo(() => {
    let filled = 0;
    let open = 0;

    for (const dayEntries of entriesByDay.values()) {
      for (const entry of dayEntries) {
        if (!entry.isSlot || entry.time.getMonth() !== monthStart.getMonth()) continue;
        if (entry.posts.length > 0) {
          filled += 1;
        } else if (entry.time > now) {
          open += 1;
        }
      }
    }

    return { filled, open };
  }, [entriesByDay, monthStart, now]);

  const isLoading = slotsLoading || postsLoading;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            className="h-8 w-8 p-0"
            onClick={() => setMonthStart((current) => addMonths(current, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="w-36 text-center text-sm font-semibold tabular-nums text-foreground">
            {format(monthStart, "MMMM yyyy")}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            className="h-8 w-8 p-0"
            onClick={() => setMonthStart((current) => addMonths(current, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="ml-1 h-8" onClick={() => setMonthStart(startOfMonth(now))}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-primary/60" />
            {summary.open} open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary/60" />
            {summary.filled} filled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/50" />
            Posted
          </span>
        </div>
      </div>

      {!slotsLoading && slots.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          No posting slots configured yet. Set them up in{" "}
          <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
            Settings
          </Link>{" "}
          to see open slots you can fill with one click.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map(({ day, label }) => (
            <div key={day} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
              {label}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day, index) => {
              const inMonth = day.getMonth() === monthStart.getMonth();
              const isToday = dayKey(day) === dayKey(now);
              const entries = entriesByDay.get(dayKey(day)) ?? [];

              return (
                <div
                  key={dayKey(day)}
                  className={cn(
                    "min-h-24 space-y-1 border-border p-1.5 sm:p-2",
                    index % 7 !== 0 && "border-l",
                    index >= 7 && "border-t",
                    !inMonth && "bg-background/40",
                  )}>
                  <div className="flex justify-end">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums",
                        isToday ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                        !inMonth && !isToday && "opacity-50",
                      )}>
                      {day.getDate()}
                    </span>
                  </div>

                  {entries.map((entry) => (
                    <CalendarEntry key={entry.key} entry={entry} now={now} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarEntry({ entry, now }: { entry: DayEntry; now: Date }) {
  const timeLabel = format(entry.time, "h:mm a");

  if (entry.posts.length === 0) {
    // Open slot: clickable in the future, muted history otherwise.
    if (entry.time <= now) {
      return (
        <div className="flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-1 text-[11px] text-muted-foreground opacity-40">
          <span className="truncate tabular-nums">{timeLabel}</span>
        </div>
      );
    }

    return (
      <Link
        href={`/schedule?slot=${entry.key}`}
        title={`Schedule a post for ${format(entry.time, "EEEE, MMMM d 'at' h:mm a")}`}
        className="group flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary">
        <span className="truncate tabular-nums">{timeLabel}</span>
        <Plus className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  const post = entry.posts[0];
  const extraCount = entry.posts.length - 1;
  const isFailed = post.status === "failed";
  const isPublished = post.status === "published";

  return (
    <Link
      href={`/posts/${post.id}`}
      title={post.message || "View post"}
      className={cn(
        "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors",
        isFailed
          ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
          : isPublished
            ? "border-border bg-secondary text-muted-foreground hover:text-foreground"
            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
      )}>
      {isFailed ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : isPublished ? (
        <CheckCircle className="h-3 w-3 shrink-0" />
      ) : null}
      <span className="shrink-0 tabular-nums">{timeLabel}</span>
      <span className="hidden truncate opacity-80 md:inline">{post.message}</span>
      {extraCount > 0 ? <span className="ml-auto shrink-0 font-medium">+{extraCount}</span> : null}
    </Link>
  );
}
