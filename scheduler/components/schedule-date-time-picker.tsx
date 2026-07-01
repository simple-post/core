"use client";

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { format } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/utils";

interface ScheduleDateTimePickerProps {
  scheduledDate: string;
  scheduledTime: string;
  onScheduledDateChange: (value: string) => void;
  onScheduledTimeChange: (value: string) => void;
  className?: string;
}

interface SchedulePickerContentProps extends ScheduleDateTimePickerProps {
  now: Date;
  onClose: () => void;
}

type Period = "AM" | "PM";

// "HH:mm" values at 30-minute steps for the time dropdown (00:00 … 23:30).
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
});

function ScheduleDateTimePicker({
  scheduledDate,
  scheduledTime,
  onScheduledDateChange,
  onScheduledTimeChange,
  className,
}: ScheduleDateTimePickerProps) {
  const labelId = useId();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!scheduledDate && !scheduledTime) {
      const defaultDateTime = getDefaultDateTime(now);
      onScheduledDateChange(formatDateValue(defaultDateTime));
      onScheduledTimeChange(formatTimeValue(defaultDateTime));
      return;
    }

    const selectedDate = parseDateValue(scheduledDate);
    if (!selectedDate) return;

    if (isBeforeToday(selectedDate, now)) {
      const recommendedDateTime = getRecommendedDateTime(now);
      onScheduledDateChange(formatDateValue(recommendedDateTime));
      onScheduledTimeChange(formatTimeValue(recommendedDateTime));
      return;
    }

    if (scheduledTime && isPastDateTime(scheduledDate, scheduledTime, now)) {
      const recommendedDateTime = getRecommendedDateTimeForDate(selectedDate, now);
      onScheduledDateChange(formatDateValue(recommendedDateTime));
      onScheduledTimeChange(formatTimeValue(recommendedDateTime));
    }
  }, [now, onScheduledDateChange, onScheduledTimeChange, scheduledDate, scheduledTime]);

  const selectedDateTime = useMemo(
    () => combineDateAndTime(scheduledDate, scheduledTime),
    [scheduledDate, scheduledTime],
  );
  const timeZoneLabel = useMemo(() => getTimeZoneLabel(), []);
  const hasCompleteDateTime = Boolean(selectedDateTime);
  const isPastSelection = selectedDateTime ? selectedDateTime <= now : false;
  const triggerLabel = getTriggerLabel(scheduledDate, scheduledTime, selectedDateTime);

  const content = (
    <SchedulePickerContent
      now={now}
      scheduledDate={scheduledDate}
      scheduledTime={scheduledTime}
      onScheduledDateChange={onScheduledDateChange}
      onScheduledTimeChange={onScheduledTimeChange}
      onClose={() => setOpen(false)}
    />
  );

  return (
    <div className={cn("space-y-3", className)}>
      <Label id={labelId} className="text-sm font-medium">
        Schedule
      </Label>

      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <ScheduleTrigger label={triggerLabel} timeZoneLabel={timeZoneLabel} isPastSelection={isPastSelection} />
          </DrawerTrigger>
          <DrawerContent aria-labelledby={labelId}>
            <DrawerHeader className="text-left">
              <DrawerTitle>Schedule</DrawerTitle>
              <DrawerDescription>
                {selectedDateTime && !isPastSelection
                  ? `${format(selectedDateTime, "EEEE, MMMM d 'at' h:mm a")} · ${timeZoneLabel}`
                  : "Pick a publishing date and time."}
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-2">{content}</div>
            <DrawerFooter>
              <Button type="button" onClick={() => setOpen(false)} disabled={!hasCompleteDateTime || isPastSelection}>
                Done
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <ScheduleTrigger label={triggerLabel} timeZoneLabel={timeZoneLabel} isPastSelection={isPastSelection} />
          </PopoverTrigger>
          <PopoverContent className="w-[min(calc(100vw-2rem),34rem)] overflow-hidden p-0" align="start">
            {content}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

interface ScheduleTriggerProps extends ComponentPropsWithoutRef<typeof Button> {
  label: string;
  timeZoneLabel: string;
  isPastSelection: boolean;
}

const ScheduleTrigger = forwardRef<HTMLButtonElement, ScheduleTriggerProps>(function ScheduleTrigger(
  { label, timeZoneLabel, isPastSelection, className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      aria-invalid={isPastSelection}
      className={cn(
        "h-auto min-h-12 w-full justify-start gap-3 text-left font-normal",
        isPastSelection && "border-destructive/50 text-destructive",
        className,
      )}
      {...props}>
      <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col items-start">
        <span className="max-w-full truncate">{label}</span>
        <span className="text-xs text-muted-foreground">{timeZoneLabel}</span>
      </span>
    </Button>
  );
});

function SchedulePickerContent({
  now,
  scheduledDate,
  scheduledTime,
  onScheduledDateChange,
  onScheduledTimeChange,
  onClose,
}: SchedulePickerContentProps) {
  const selectedDate = parseDateValue(scheduledDate);
  const presets = useMemo(() => getPresetOptions(now), [now]);

  // When the chosen day is today, stop the native time field from stepping into the past.
  const minTime = selectedDate && isSameCalendarDay(selectedDate, now) ? formatTimeValue(now) : undefined;

  const [timeOpen, setTimeOpen] = useState(false);
  const activeTimeRef = useRef<HTMLButtonElement>(null);

  const commitDateTime = (dateTime: Date, closeAfterCommit = false) => {
    onScheduledDateChange(formatDateValue(dateTime));
    onScheduledTimeChange(formatTimeValue(dateTime));
    if (closeAfterCommit) onClose();
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;

    const nextDateValue = formatDateValue(date);
    const shouldKeepTime = scheduledTime && !isPastDateTime(nextDateValue, scheduledTime, now);

    onScheduledDateChange(nextDateValue);
    if (!shouldKeepTime) {
      onScheduledTimeChange(formatTimeValue(getRecommendedDateTimeForDate(date, now)));
    }
  };

  const commitTime = (timeValue: string) => {
    const nextDateValue = getDateValueForTime(scheduledDate, timeValue, now);
    if (isPastDateTime(nextDateValue, timeValue, now)) return;

    if (nextDateValue !== scheduledDate) {
      onScheduledDateChange(nextDateValue);
    }
    onScheduledTimeChange(timeValue);
  };

  return (
    <div className="flex flex-col sm:flex-row">
      <div className="flex justify-center border-b border-border p-3 sm:border-b-0 sm:border-r">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          disabled={(date) => !dateHasAvailableTime(date, now)}
          className="p-0"
        />
      </div>

      <div className="flex w-full flex-col gap-5 p-4 sm:w-64">
        <section className="space-y-1.5">
          <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground">Quick picks</p>
          <div className="space-y-0.5">
            {presets.map((preset) => {
              const isActive =
                formatDateValue(preset.dateTime) === scheduledDate &&
                formatTimeValue(preset.dateTime) === scheduledTime;

              return (
                <button
                  key={preset.id}
                  type="button"
                  data-active={isActive}
                  onClick={() => commitDateTime(preset.dateTime, true)}
                  className="group flex w-full flex-col items-start gap-0.5 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-secondary data-[active=true]:border-primary/30 data-[active=true]:bg-primary/10">
                  <span className="text-sm font-medium text-foreground group-data-[active=true]:text-primary">
                    {preset.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(preset.dateTime, "EEE, MMM d · h:mm a")}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground">Time</p>
          <Popover open={timeOpen} onOpenChange={setTimeOpen}>
            <PopoverAnchor asChild>
              <div className="flex w-44 items-center rounded-lg border border-border bg-input/60 pr-1.5 transition-colors focus-within:border-primary/40 focus-within:ring-[3px] focus-within:ring-primary/20">
                <input
                  type="time"
                  aria-label="Time"
                  step={60}
                  value={scheduledTime}
                  min={minTime}
                  onChange={(event) => {
                    if (event.target.value) commitTime(event.target.value);
                  }}
                  className="w-full min-w-0 flex-1 bg-transparent px-3 py-2 text-base font-medium tabular-nums text-foreground outline-none [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:hidden"
                />
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Choose a time"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <ChevronDown className="size-4" />
                  </button>
                </PopoverTrigger>
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              sideOffset={6}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                activeTimeRef.current?.focus();
              }}
              className="max-h-60 w-[var(--radix-popper-anchor-width)] overflow-y-auto p-1">
              {TIME_OPTIONS.map((value) => {
                const disabled = isPastDateTime(scheduledDate, value, now);
                const isActive = value === scheduledTime;

                return (
                  <button
                    key={value}
                    ref={isActive ? activeTimeRef : undefined}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      commitTime(value);
                      setTimeOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center rounded-md px-3 py-1.5 text-sm tabular-nums outline-none transition-colors focus-visible:bg-secondary disabled:pointer-events-none disabled:opacity-40",
                      isActive ? "bg-primary/15 font-medium text-primary" : "text-foreground hover:bg-secondary",
                    )}>
                    {formatTimeLabel(value)}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
        </section>
      </div>
    </div>
  );
}

interface TimeParts {
  hour24: number;
  hour12: number;
  minute: number;
  period: Period;
}

function parseDateValue(value: string): Date | undefined {
  if (!value) return undefined;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseTimeValue(value: string): TimeParts | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;

  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 > 23 || minute > 59) return undefined;

  return {
    hour24,
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute,
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

function combineDateAndTime(dateValue: string, timeValue: string): Date | undefined {
  const date = parseDateValue(dateValue);
  const time = parseTimeValue(timeValue);
  if (!date || !time) return undefined;

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour24, time.minute);
}

function formatDateValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatTimeValue(date: Date): string {
  return format(date, "HH:mm");
}

function formatTimeLabel(timeValue: string): string {
  const dateTime = combineDateAndTime("2000-01-01", timeValue);
  return dateTime ? format(dateTime, "h:mm a") : timeValue;
}

function getTriggerLabel(dateValue: string, timeValue: string, dateTime: Date | undefined): string {
  if (dateTime) return format(dateTime, "EEE, MMM d 'at' h:mm a");

  const date = parseDateValue(dateValue);
  if (date) return `${format(date, "EEE, MMM d")} at pick time`;

  const time = parseTimeValue(timeValue);
  if (time) return `Pick date at ${formatTimeLabel(timeValue)}`;

  return "Pick date and time";
}

function getTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
}

function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return startOfCalendarDay(left).getTime() === startOfCalendarDay(right).getTime();
}

function isBeforeToday(date: Date, now: Date): boolean {
  return startOfCalendarDay(date) < startOfCalendarDay(now);
}

function dateHasAvailableTime(date: Date, now: Date): boolean {
  if (isBeforeToday(date, now)) return false;
  if (!isSameCalendarDay(date, now)) return true;

  const lastSelectableTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 55);
  return lastSelectableTime > now;
}

function isPastDateTime(dateValue: string, timeValue: string, now: Date): boolean {
  const dateTime = combineDateAndTime(dateValue, timeValue);
  return dateTime ? dateTime <= now : false;
}

function roundUpToMinutes(date: Date, intervalMinutes: number): Date {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const remainder = minutes % intervalMinutes;

  rounded.setSeconds(0, 0);
  if (remainder !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) {
    rounded.setMinutes(minutes + (intervalMinutes - remainder));
  }

  return rounded;
}

function addCalendarDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function atTime(date: Date, hour: number, minute = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
}

function getRecommendedDateTime(now: Date): Date {
  return roundUpToMinutes(new Date(now.getTime() + 60 * 60 * 1000), 15);
}

function getDefaultDateTime(now: Date): Date {
  return roundUpToMinutes(new Date(now.getTime() + 2 * 60 * 60 * 1000), 15);
}

function getRecommendedDateTimeForDate(date: Date, now: Date): Date {
  if (!isSameCalendarDay(date, now)) {
    return atTime(date, 9);
  }

  const nextTime = roundUpToMinutes(new Date(now.getTime() + 60 * 1000), 5);
  return isSameCalendarDay(nextTime, now) ? nextTime : getRecommendedDateTime(now);
}

function getDateValueForTime(currentDateValue: string, timeValue: string, now: Date): string {
  const currentDate = parseDateValue(currentDateValue);
  if (currentDate && !isBeforeToday(currentDate, now)) return currentDateValue;

  const todayValue = formatDateValue(now);
  return isPastDateTime(todayValue, timeValue, now) ? formatDateValue(addCalendarDays(now, 1)) : todayValue;
}

function getPresetOptions(now: Date): Array<{ id: string; label: string; dateTime: Date }> {
  const inOneHour = getRecommendedDateTime(now);
  const todayEvening = atTime(now, 18);
  const evening = todayEvening > now ? todayEvening : atTime(addCalendarDays(now, 1), 18);
  const tomorrowMorning = atTime(addCalendarDays(now, 1), 9);
  const nextWeekday = getNextWeekdayMorning(now);

  return [
    { id: "one-hour", label: "In 1 hour", dateTime: inOneHour },
    { id: "evening", label: isSameCalendarDay(evening, now) ? "Tonight" : "Tomorrow evening", dateTime: evening },
    { id: "tomorrow", label: "Tomorrow morning", dateTime: tomorrowMorning },
    { id: "weekday", label: "Next weekday", dateTime: nextWeekday },
  ];
}

function getNextWeekdayMorning(now: Date): Date {
  let date = addCalendarDays(now, 1);

  while (date.getDay() === 0 || date.getDay() === 6) {
    date = addCalendarDays(date, 1);
  }

  return atTime(date, 9);
}

export { ScheduleDateTimePicker };
