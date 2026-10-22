"use client";
import { createContext, useContext, type ReactNode } from "react";

import { format } from "date-fns";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { PlatformIconBadge } from "../platform-icons";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
export type CalendarView = "month" | "week" | "day";
export type CalendarPostData = {
  id: string;
  message: string;
  status: string;
  platforms?: string[];
  errorMessage?: string | null;
};
export interface DayEntry {
  key: string;
  time: Date;
  timeLabel?: string;
  isPast?: boolean;
  isSlot: boolean;
  posts: CalendarPostData[];
}
export type CalendarAction = { kind: "post" | "slot"; id: string } | { kind: "settings" | "create" };
export type CalendarActionProps = { target: CalendarAction; children: ReactNode; className?: string; title?: string };
const Actions = createContext<{ renderAction: (props: CalendarActionProps) => ReactNode; slotHint: string } | null>(
  null,
);
function useCalendarActions() {
  const value = useContext(Actions);
  if (!value) throw new Error("Calendar actions missing");
  return value;
}
function Action(props: CalendarActionProps) {
  const { renderAction: Render } = useCalendarActions();
  return Render(props);
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, day) => ({ label, day }));
const CALENDAR_VIEWS = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;
function isCalendarView(value: string): value is CalendarView {
  return ["month", "week", "day"].includes(value);
}
function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}
function isSameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b);
}
export interface ScheduleCalendarViewProps {
  view: CalendarView;
  periodLabel: string;
  range: { days: Date[]; periodStart: Date };
  anchorDate: Date;
  now: Date;
  entriesByDay: Map<string, DayEntry[]>;
  summary: { open: number; scheduled: number; posted: number; failed?: number };
  isLoading?: boolean;
  showEmptySlots?: boolean;
  help?: ReactNode;
  setAnchorDate: (date: Date) => void;
  setView: (view: CalendarView) => void;
  move: (direction: -1 | 1) => void;
  onToday: () => void;
  renderAction: (props: CalendarActionProps) => ReactNode;
  slotHint?: string;
  onOpenDay?: (date: Date) => void;
}
export function ScheduleCalendarView(props: ScheduleCalendarViewProps) {
  return (
    <Actions.Provider
      value={{ renderAction: props.renderAction, slotHint: props.slotHint ?? "Tap to create and schedule a post" }}>
      <div className="simplepost-visual">
        <CalendarBody {...props} />
      </div>
    </Actions.Provider>
  );
}
function CalendarBody({
  view,
  periodLabel,
  range,
  anchorDate,
  now,
  entriesByDay,
  summary,
  isLoading,
  showEmptySlots,
  help,
  setAnchorDate,
  setView,
  move,
  onToday,
  onOpenDay,
}: ScheduleCalendarViewProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_55px_rgba(0,0,0,0.16)]">
      <div className="p-3 sm:p-4">
        {help}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Previous ${view}`}
              className="h-10 w-10 shrink-0 p-0 sm:h-9 sm:w-9"
              onClick={() => move(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Next ${view}`}
              className="h-10 w-10 shrink-0 p-0 sm:h-9 sm:w-9"
              onClick={() => move(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>

            <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.01em] text-foreground sm:text-base">
              {periodLabel}
            </h3>

            <Button variant="outline" size="sm" className="ml-1 h-9 shrink-0 px-3 text-xs sm:text-sm" onClick={onToday}>
              Today
            </Button>
          </div>

          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) => {
              if (isCalendarView(value)) setView(value);
            }}
            aria-label="Calendar view"
            className="grid w-full grid-cols-3 rounded-xl border border-border bg-background/50 p-1 lg:w-auto">
            {CALENDAR_VIEWS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={`${option.label} view`}
                className={cn(
                  "h-9 rounded-lg border-0 px-4 text-xs font-medium transition-all first:rounded-lg last:rounded-lg sm:text-sm",
                  view === option.value
                    ? "border border-border bg-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground sm:text-xs">
          <SummaryItem tone="open" count={summary.open} label="open" />
          <SummaryItem tone="scheduled" count={summary.scheduled} label="scheduled" />
          <SummaryItem tone="posted" count={summary.posted} label="posted" />
          {summary.failed ? <SummaryItem tone="failed" count={summary.failed} label="failed" /> : null}
        </div>
      </div>

      {showEmptySlots ? (
        <div className="border-t border-border bg-background/20 px-4 py-2.5 text-xs text-muted-foreground">
          No posting slots yet. Add your preferred times in{" "}
          <Action
            target={{ kind: "settings" }}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
            Settings
          </Action>
          .
        </div>
      ) : null}

      <div className="border-t border-border">
        {isLoading ? (
          <CalendarSkeleton view={view} />
        ) : view === "month" ? (
          <MonthView
            days={range.days}
            monthStart={range.periodStart}
            selectedDate={anchorDate}
            entriesByDay={entriesByDay}
            now={now}
            onSelectDay={setAnchorDate}
            onOpenDay={(date) => {
              if (onOpenDay) onOpenDay(date);
              else {
                setAnchorDate(date);
                setView("day");
              }
            }}
          />
        ) : view === "week" ? (
          <WeekView
            days={range.days}
            entriesByDay={entriesByDay}
            now={now}
            onOpenDay={(date) => {
              if (onOpenDay) onOpenDay(date);
              else {
                setAnchorDate(date);
                setView("day");
              }
            }}
          />
        ) : (
          <DayAgenda
            day={range.periodStart}
            entries={entriesByDay.get(dayKey(range.periodStart)) ?? []}
            now={now}
            showHeader={false}
            emptyAction
          />
        )}
      </div>
    </div>
  );
}

function SummaryItem({
  tone,
  count,
  label,
}: {
  tone: "open" | "scheduled" | "posted" | "failed";
  count: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          tone === "open" && "border border-primary/70 bg-transparent",
          tone === "scheduled" && "bg-primary",
          tone === "posted" && "bg-muted-foreground/60",
          tone === "failed" && "bg-destructive",
        )}
      />
      <span className="tabular-nums text-foreground">{count}</span> {label}
    </span>
  );
}

function CalendarSkeleton({ view }: { view: CalendarView }) {
  if (view === "day") {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-7 md:gap-0 md:p-0">
      {Array.from({ length: view === "week" ? 7 : 14 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-lg md:h-28 md:rounded-none" />
      ))}
    </div>
  );
}

function MonthView({
  days,
  monthStart,
  selectedDate,
  entriesByDay,
  now,
  onSelectDay,
  onOpenDay,
}: {
  days: Date[];
  monthStart: Date;
  selectedDate: Date;
  entriesByDay: Map<string, DayEntry[]>;
  now: Date;
  onSelectDay: (date: Date) => void;
  onOpenDay: (date: Date) => void;
}) {
  const selectedEntries = entriesByDay.get(dayKey(selectedDate)) ?? [];

  return (
    <>
      <div className="md:hidden">
        <WeekdayHeader compact />
        <div className="grid grid-cols-7 gap-y-1 px-2 py-2">
          {days.map((day) => {
            const entries = entriesByDay.get(dayKey(day)) ?? [];
            const inMonth = day.getMonth() === monthStart.getMonth();
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, now);

            return (
              <button
                key={dayKey(day)}
                type="button"
                aria-label={format(day, "EEEE, MMMM d, yyyy")}
                aria-pressed={isSelected}
                onClick={() => onSelectDay(day)}
                className={cn(
                  "mx-auto flex h-11 w-full max-w-11 flex-col items-center justify-center gap-1 rounded-xl text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                  !inMonth && "opacity-35",
                )}>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}>
                  {day.getDate()}
                </span>
                <EntryMarkers entries={entries} now={now} />
              </button>
            );
          })}
        </div>
        <div className="border-t border-border">
          <DayAgenda
            day={selectedDate}
            entries={selectedEntries}
            now={now}
            showHeader
            emptyAction
            onOpenDay={onOpenDay}
          />
        </div>
      </div>

      <div className="hidden md:block">
        <WeekdayHeader />
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const entries = entriesByDay.get(dayKey(day)) ?? [];
            const inMonth = day.getMonth() === monthStart.getMonth();
            const isToday = isSameDay(day, now);
            const hiddenCount = Math.max(0, entries.length - 3);

            return (
              <div
                key={dayKey(day)}
                className={cn(
                  "min-h-28 space-y-1.5 border-border p-2 lg:min-h-32",
                  index % 7 !== 0 && "border-l",
                  index >= 7 && "border-t",
                  !inMonth && "bg-background/30",
                  isToday && "bg-primary/[0.025]",
                )}>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={`Open ${format(day, "MMMM d")} in day view`}
                    onClick={() => onOpenDay(day)}
                    className={cn(
                      "flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs tabular-nums transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isToday
                        ? "bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                        : "text-muted-foreground",
                      !inMonth && !isToday && "opacity-50",
                    )}>
                    {day.getDate()}
                  </button>
                </div>

                {entries.slice(0, 3).map((entry) => (
                  <CalendarEntry key={entry.key} entry={entry} now={now} variant="compact" />
                ))}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className="w-full rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    +{hiddenCount} more
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function WeekdayHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-7 border-b border-border bg-background/25", compact && "border-b-0 px-2 pt-2")}>
      {WEEKDAYS.map(({ day, label }) => (
        <div
          key={day}
          className={cn(
            "py-2 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
            !compact && "px-2",
          )}>
          {compact ? label.slice(0, 1) : label}
        </div>
      ))}
    </div>
  );
}

function EntryMarkers({ entries, now }: { entries: DayEntry[]; now: Date }) {
  if (entries.length === 0) return <span className="h-1" />;

  return (
    <span className="flex h-1 items-center gap-0.5" aria-hidden="true">
      {entries.slice(0, 3).map((entry) => {
        const post = entry.posts[0];
        return (
          <span
            key={entry.key}
            className={cn(
              "h-1 w-1 rounded-full",
              entry.posts.length === 0 &&
                !(entry.isPast ?? entry.time <= now) &&
                "border border-primary bg-transparent",
              entry.posts.length === 0 && (entry.isPast ?? entry.time <= now) && "bg-muted-foreground/30",
              post?.status === "failed" && "bg-destructive",
              post?.status === "published" && "bg-muted-foreground",
              post && post.status !== "failed" && post.status !== "published" && "bg-primary",
            )}
          />
        );
      })}
    </span>
  );
}

function WeekView({
  days,
  entriesByDay,
  now,
  onOpenDay,
}: {
  days: Date[];
  entriesByDay: Map<string, DayEntry[]>;
  now: Date;
  onOpenDay: (date: Date) => void;
}) {
  return (
    <>
      <div className="divide-y divide-border md:hidden">
        {days.map((day) => (
          <DayAgenda
            key={dayKey(day)}
            day={day}
            entries={entriesByDay.get(dayKey(day)) ?? []}
            now={now}
            showHeader
            onOpenDay={onOpenDay}
          />
        ))}
      </div>

      <div className="hidden grid-cols-7 md:grid">
        {days.map((day, index) => {
          const entries = entriesByDay.get(dayKey(day)) ?? [];
          const isToday = isSameDay(day, now);
          return (
            <div
              key={dayKey(day)}
              className={cn("min-h-72 border-border", index !== 0 && "border-l", isToday && "bg-primary/[0.025]")}>
              <button
                type="button"
                aria-label={`Open ${format(day, "EEEE, MMMM d")} in day view`}
                onClick={() => onOpenDay(day)}
                className="w-full border-b border-border bg-background/25 px-2 py-3 text-center transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {format(day, "EEE")}
                </div>
                <div
                  className={cn(
                    "mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}>
                  {day.getDate()}
                </div>
              </button>

              <div className="space-y-1.5 p-2">
                {entries.length > 0 ? (
                  entries.map((entry) => <CalendarEntry key={entry.key} entry={entry} now={now} variant="compact" />)
                ) : (
                  <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/60">No activity</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DayAgenda({
  day,
  entries,
  now,
  showHeader,
  emptyAction = false,
  onOpenDay,
}: {
  day: Date;
  entries: DayEntry[];
  now: Date;
  showHeader: boolean;
  emptyAction?: boolean;
  onOpenDay?: (date: Date) => void;
}) {
  const isToday = isSameDay(day, now);
  const itemCount = entries.reduce((count, entry) => count + Math.max(1, entry.posts.length), 0);

  return (
    <section className="p-3 sm:p-4" aria-label={format(day, "EEEE, MMMM d")}>
      {showHeader ? (
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!onOpenDay}
            aria-label={onOpenDay ? `Open ${format(day, "EEEE, MMMM d")} in day view` : undefined}
            onClick={() => onOpenDay?.(day)}
            className={cn(
              "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-background/40 transition-colors",
              onOpenDay &&
                "hover:border-primary/30 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isToday && "border-primary/30 bg-primary/10",
            )}>
            <span className="text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
              {format(day, "EEE")}
            </span>
            <span className={cn("mt-1 text-sm font-semibold leading-none tabular-nums", isToday && "text-primary")}>
              {day.getDate()}
            </span>
          </button>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-foreground">
              {isToday ? "Today" : format(day, "EEEE")}
            </h4>
            <p className="text-xs text-muted-foreground">{format(day, "MMMM d, yyyy")}</p>
          </div>
          {entries.length > 0 ? (
            <span className="ml-auto rounded-full bg-secondary px-2 py-1 text-[10px] tabular-nums text-muted-foreground">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <CalendarEntry key={entry.key} entry={entry} now={now} variant="agenda" />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-20 items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3",
            !emptyAction && "min-h-0 border-0 px-1 py-1",
          )}>
          <div>
            <p className="text-sm font-medium text-foreground/80">Nothing planned</p>
            {emptyAction ? (
              <p className="mt-0.5 text-xs text-muted-foreground">This day is ready for a new post.</p>
            ) : null}
          </div>
          {emptyAction ? (
            <Button asChild variant="outline" size="sm" className="h-9 shrink-0 px-3 text-xs">
              <Action target={{ kind: "create" }}>
                <Plus className="h-3.5 w-3.5" />
                Add post
              </Action>
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CalendarEntry({ entry, now, variant }: { entry: DayEntry; now: Date; variant: "compact" | "agenda" }) {
  const { slotHint } = useCalendarActions();
  const timeLabel = entry.timeLabel ?? format(entry.time, "h:mm a");

  if (entry.posts.length === 0) {
    const isPast = entry.isPast ?? entry.time <= now;

    if (variant === "compact") {
      if (isPast) {
        return (
          <div className="rounded-md border border-dashed border-border px-1.5 py-1 text-[10px] text-muted-foreground opacity-35">
            <span className="tabular-nums">{timeLabel}</span>
          </div>
        );
      }

      return (
        <Action
          target={{ kind: "slot", id: entry.key }}
          title={`Schedule a post for ${format(entry.time, "EEEE, MMMM d 'at' h:mm a")}`}
          className="group flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary">
          <span className="truncate tabular-nums">{timeLabel}</span>
          <Plus className="ml-auto h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
        </Action>
      );
    }

    if (isPast) {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3 py-3 opacity-45">
          <time className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{timeLabel}</time>
          <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Unused posting slot</span>
        </div>
      );
    }

    return (
      <Action
        target={{ kind: "slot", id: entry.key }}
        className="group flex min-h-16 items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/[0.035] px-3 py-3 transition-all hover:border-primary hover:bg-primary/[0.075]">
        <time className="w-16 shrink-0 text-xs font-semibold tabular-nums text-primary">{timeLabel}</time>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <Plus className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Open posting slot</span>
          <span className="block truncate text-xs text-muted-foreground">{slotHint}</span>
        </span>
      </Action>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-1.5",
        variant === "compact"
          ? "grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))]"
          : "grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]",
      )}>
      {entry.posts.map((post) => (
        <CalendarPost key={post.id} post={post} timeLabel={timeLabel} variant={variant} />
      ))}
    </div>
  );
}

function CalendarPost({
  post,
  timeLabel,
  variant,
}: {
  post: CalendarPostData;
  timeLabel: string;
  variant: "compact" | "agenda";
}) {
  const isFailed = post.status === "failed" || post.status === "past_due";
  const isPublished = post.status === "published";
  const message = post.message.trim() || "Untitled post";
  const statusLabel = isFailed
    ? post.status === "past_due"
      ? "Past due"
      : "Failed"
    : isPublished
      ? "Posted"
      : post.status === "pending"
        ? "Publishing"
        : "Scheduled";

  if (variant === "compact") {
    return (
      <Action
        target={{ kind: "post", id: post.id }}
        title={message}
        className={cn(
          "block min-w-0 rounded-md border px-1.5 py-1 text-[10px] transition-colors",
          isFailed
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
            : isPublished
              ? "border-border bg-secondary text-muted-foreground hover:text-foreground"
              : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
        )}>
        <span className="flex min-w-0 items-center gap-1">
          {isFailed ? (
            <AlertCircle className="h-3 w-3 shrink-0" />
          ) : isPublished ? (
            <CheckCircle2 className="h-3 w-3 shrink-0" />
          ) : null}
          <span className="truncate tabular-nums">{timeLabel}</span>
          {post.platforms?.map((platform) => (
            <PlatformIconBadge key={platform} platform={platform} className="size-4" />
          ))}
        </span>
        <span className="mt-1 block truncate text-[10px] opacity-75">{message}</span>
      </Action>
    );
  }

  return (
    <Action
      target={{ kind: "post", id: post.id }}
      className={cn(
        "group flex min-h-16 min-w-0 items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
        isFailed
          ? "border-destructive/35 bg-destructive/[0.06] hover:bg-destructive/10"
          : isPublished
            ? "border-border bg-background/25 hover:bg-secondary/70"
            : "border-primary/25 bg-primary/[0.035] hover:border-primary/40 hover:bg-primary/[0.07]",
      )}>
      <time
        className={cn(
          "w-16 shrink-0 text-xs font-semibold tabular-nums",
          isFailed ? "text-destructive" : isPublished ? "text-muted-foreground" : "text-primary",
        )}>
        {timeLabel}
      </time>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          isFailed && "border-destructive/20 bg-destructive/10 text-destructive",
          isPublished && "border-border bg-secondary text-muted-foreground",
          !isFailed && !isPublished && "border-primary/20 bg-primary/10 text-primary",
        )}>
        {isFailed ? (
          <AlertCircle className="h-4 w-4" />
        ) : isPublished ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Clock3 className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{message}</span>
        <span className={cn("mt-0.5 block text-[11px]", isFailed ? "text-destructive" : "text-muted-foreground")}>
          {statusLabel}
        </span>
        {post.platforms?.length ? (
          <span className="mt-1 flex gap-1" aria-label="Platforms">
            {post.platforms.map((platform) => (
              <PlatformIconBadge key={platform} platform={platform} />
            ))}
          </span>
        ) : null}
        {post.errorMessage ? <span className="mt-1 block text-xs text-destructive">{post.errorMessage}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-50 transition-transform group-hover:translate-x-0.5" />
    </Action>
  );
}
