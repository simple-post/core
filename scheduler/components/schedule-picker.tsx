"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { format } from "date-fns";
import { CalendarClock, Check, ChevronDown, Zap } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePostingSlots } from "@/hooks/use-posting-slots";
import { usePaginatedPosts } from "@/hooks/use-posts";
import { getUpcomingSlotOccurrences, hasEnabledSlots, slotOccurrenceKey } from "@/lib/posting-slots/occurrences";
import { cn } from "@/lib/utils";

import { ScheduleDateTimePicker } from "./schedule-date-time-picker";

// How many upcoming slot occurrences to offer in the picker list.
const UPCOMING_SLOT_COUNT = 14;

interface SchedulePickerProps {
  scheduledDate: string;
  scheduledTime: string;
  onScheduledDateChange: (value: string) => void;
  onScheduledTimeChange: (value: string) => void;
  /** Post being edited, so its own scheduled time doesn't count as a filled slot. */
  excludePostId?: string;
}

/**
 * Schedule section of the post forms: one-click "next open slot" scheduling
 * and a list of upcoming posting slots on top of the custom date-time picker.
 * Falls back to just the custom picker when no slots are configured.
 */
export function SchedulePicker({
  scheduledDate,
  scheduledTime,
  onScheduledDateChange,
  onScheduledTimeChange,
  excludePostId,
}: SchedulePickerProps) {
  const { data: slots = [], isLoading: slotsLoading } = usePostingSlots();
  // Slot occupancy only needs upcoming scheduled posts; 100 covers any
  // realistic queue and matches the API's page-size cap.
  const { data: scheduledPosts } = usePaginatedPosts("scheduled", 1, 100);
  const [listOpen, setListOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const upcomingSlots = useMemo(() => getUpcomingSlotOccurrences(slots, now, UPCOMING_SLOT_COUNT), [now, slots]);

  const filledSlotKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const post of scheduledPosts?.posts ?? []) {
      if (post.id !== excludePostId && post.scheduledFor) {
        keys.add(slotOccurrenceKey(post.scheduledFor));
      }
    }
    return keys;
  }, [excludePostId, scheduledPosts?.posts]);

  const nextOpenSlot = upcomingSlots.find((occurrence) => !filledSlotKeys.has(slotOccurrenceKey(occurrence)));
  const selectedKey = scheduledDate && scheduledTime ? `${scheduledDate}T${scheduledTime}` : null;

  const selectSlot = (occurrence: Date) => {
    onScheduledDateChange(format(occurrence, "yyyy-MM-dd"));
    onScheduledTimeChange(format(occurrence, "HH:mm"));
  };

  const showSlotUi = hasEnabledSlots(slots) && upcomingSlots.length > 0;
  // Slots exist but every weekday is unchecked: point at Settings instead of
  // silently hiding the slot UI.
  const showInactiveSlotsHint = !slotsLoading && slots.length > 0 && !showSlotUi;

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Schedule</Label>

      {showInactiveSlotsHint ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="h-4 w-4 text-primary" />
            No active posting slots
          </span>
          <Link
            href="/settings"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Enable days in Settings
          </Link>
        </div>
      ) : null}

      {showSlotUi ? (
        <>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              disabled={!nextOpenSlot}
              data-active={Boolean(nextOpenSlot && selectedKey === slotOccurrenceKey(nextOpenSlot))}
              onClick={() => nextOpenSlot && selectSlot(nextOpenSlot)}
              className="group flex min-h-12 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-60 data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10">
              <Zap className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground group-data-[active=true]:text-primary">
                  {nextOpenSlot ? "Schedule for next slot" : "All upcoming slots are filled"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {nextOpenSlot
                    ? format(nextOpenSlot, "EEE, MMM d 'at' h:mm a")
                    : "Pick a custom time below or free up a slot."}
                </span>
              </span>
              {nextOpenSlot && selectedKey === slotOccurrenceKey(nextOpenSlot) ? (
                <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </button>

            <Popover open={listOpen} onOpenChange={setListOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Choose a posting slot"
                  className="flex min-h-12 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <CalendarClock className="h-4 w-4" />
                  <span className="hidden sm:inline">All slots</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="max-h-72 w-64 overflow-y-auto p-1">
                {upcomingSlots.map((occurrence) => {
                  const key = slotOccurrenceKey(occurrence);
                  const isFilled = filledSlotKeys.has(key);
                  const isActive = selectedKey === key;

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isFilled}
                      onClick={() => {
                        selectSlot(occurrence);
                        setListOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:bg-secondary disabled:pointer-events-none",
                        isActive ? "bg-primary/15 font-medium text-primary" : "text-foreground hover:bg-secondary",
                      )}>
                      <span className={cn("tabular-nums", isFilled && "text-muted-foreground line-through")}>
                        {format(occurrence, "EEE, MMM d · h:mm a")}
                      </span>
                      {isFilled ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Filled
                        </span>
                      ) : isActive ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or pick a custom time</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <ScheduleDateTimePicker
        hideLabel
        scheduledDate={scheduledDate}
        scheduledTime={scheduledTime}
        onScheduledDateChange={onScheduledDateChange}
        onScheduledTimeChange={onScheduledTimeChange}
      />

      {!slotsLoading && slots.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Tip: set up posting slots in{" "}
          <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
            Settings
          </Link>{" "}
          to schedule recurring times with one click.
        </p>
      ) : null}
    </div>
  );
}
