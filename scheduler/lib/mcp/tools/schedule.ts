import { z } from "zod";

import { PostsModel } from "@/lib/db";
import { getUserPostingSlots } from "@/lib/posting-slots/settings";
import { prisma } from "@/lib/prisma";

export const scheduleViewSchema = z.enum(["day", "week", "month"]);
export type ScheduleView = z.infer<typeof scheduleViewSchema>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const showScheduleSchema = z.object({
  view: scheduleViewSchema
    .default("week")
    .describe("Calendar period to retrieve. Use day, week, or month based on the user's request."),
  date: z
    .string()
    .regex(ISO_DATE_PATTERN, "date must use YYYY-MM-DD")
    .optional()
    .describe("Date inside the requested period, in the user's timezone. Defaults to today."),
  timeZone: z
    .string()
    .default("UTC")
    .describe("IANA timezone used for calendar boundaries and recurring posting slots, such as Europe/Berlin."),
});

const scheduleEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["slot", "post"]),
  at: z.string(),
  localTime: z.string(),
  isPast: z.boolean(),
  postId: z.string().nullable(),
  message: z.string().nullable(),
  status: z.enum(["open", "scheduled", "pending", "published", "failed", "past_due"]),
  platforms: z.array(z.string()),
  errorMessage: z.string().nullable(),
});

const scheduleDaySchema = z.object({
  date: z.string(),
  weekday: z.string(),
  weekdayShort: z.string(),
  dayNumber: z.number(),
  inPeriod: z.boolean(),
  isToday: z.boolean(),
  entries: z.array(scheduleEntrySchema),
});

export const showScheduleOutputSchema = z.object({
  kind: z.literal("schedule"),
  view: scheduleViewSchema,
  anchorDate: z.string(),
  previousAnchorDate: z.string(),
  nextAnchorDate: z.string(),
  todayAnchorDate: z.string(),
  timeZone: z.string(),
  periodLabel: z.string(),
  rangeStart: z.string(),
  rangeEnd: z.string(),
  days: z.array(scheduleDaySchema),
  summary: z.object({
    openSlotCount: z.number(),
    scheduledCount: z.number(),
    publishedCount: z.number(),
    failedCount: z.number(),
    pastCount: z.number(),
  }),
});

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type ZonedParts = CalendarDate & {
  hour: number;
  minute: number;
};

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Unsupported timezone: ${timeZone}`);
  }
}

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("date must use YYYY-MM-DD");
  const [, year, month, day] = match.map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new Error("date must be a real calendar date");
  }
  return { year, month, day };
}

function calendarDateToUtc(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function formatCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(
    2,
    "0",
  )}`;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = calendarDateToUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: 1 };
}

function startOfCalendarMonth(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

function startOfCalendarWeek(date: CalendarDate): CalendarDate {
  const day = calendarDateToUtc(date).getUTCDay();
  return addCalendarDays(date, -((day + 6) % 7));
}

function calendarDateForInstant(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
  };
}

function zonedPartsForInstant(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

function zonedDateTimeToInstant(date: CalendarDate, time: string, timeZone: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Invalid posting slot time: ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedPartsForInstant(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const difference = target - actualAsUtc;
    if (difference === 0) break;
    guess += difference;
  }

  return new Date(guess);
}

function formatCalendarLabel(date: CalendarDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(calendarDateToUtc(date));
}

function getPeriod(view: ScheduleView, anchor: CalendarDate) {
  if (view === "month") {
    const periodStart = startOfCalendarMonth(anchor);
    const periodEnd = addCalendarMonths(periodStart, 1);
    const fetchStart = startOfCalendarWeek(periodStart);
    const fetchEnd = startOfCalendarWeek(addCalendarDays(periodEnd, 6));
    return { periodStart, periodEnd, fetchStart, fetchEnd };
  }

  const periodStart = view === "week" ? startOfCalendarWeek(anchor) : anchor;
  const periodEnd = addCalendarDays(periodStart, view === "week" ? 7 : 1);
  return { periodStart, periodEnd, fetchStart: periodStart, fetchEnd: periodEnd };
}

function getPeriodLabel(view: ScheduleView, start: CalendarDate, end: CalendarDate): string {
  if (view === "month") {
    return formatCalendarLabel(start, { month: "long", year: "numeric" });
  }
  if (view === "day") {
    return formatCalendarLabel(start, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  const lastDay = addCalendarDays(end, -1);
  const startLabel = formatCalendarLabel(start, { month: "short", day: "numeric" });
  const endLabel = formatCalendarLabel(lastDay, {
    month: start.month === lastDay.month ? undefined : "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel}–${endLabel}`;
}

function getNavigationAnchor(view: ScheduleView, anchor: CalendarDate, direction: -1 | 1): CalendarDate {
  if (view === "month") return addCalendarMonths(anchor, direction);
  return addCalendarDays(anchor, direction * (view === "week" ? 7 : 1));
}

function localMinuteKey(instant: Date, timeZone: string): string {
  const parts = zonedPartsForInstant(instant, timeZone);
  return `${formatCalendarDate(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function localTimeLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function enumerateDays(start: CalendarDate, end: CalendarDate): CalendarDate[] {
  const days: CalendarDate[] = [];
  for (let cursor = start; formatCalendarDate(cursor) < formatCalendarDate(end); cursor = addCalendarDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

function postStatus(post: { status: string; scheduledFor: Date | null }, now: Date) {
  if (post.status === "failed") return "failed" as const;
  if (post.status === "published") return "published" as const;
  if (post.status === "pending") return "pending" as const;
  if (post.scheduledFor && post.scheduledFor <= now) return "past_due" as const;
  return "scheduled" as const;
}

export async function getSchedule(
  userId: string,
  input: z.infer<typeof showScheduleSchema>,
): Promise<z.infer<typeof showScheduleOutputSchema>> {
  validateTimeZone(input.timeZone);
  const now = new Date();
  const today = calendarDateForInstant(now, input.timeZone);
  const anchor = input.date ? parseCalendarDate(input.date) : today;
  const period = getPeriod(input.view, anchor);
  const rangeStart = zonedDateTimeToInstant(period.fetchStart, "00:00", input.timeZone);
  const rangeEnd = zonedDateTimeToInstant(period.fetchEnd, "00:00", input.timeZone);
  const repository = new PostsModel(userId);
  const [slots, posts] = await Promise.all([
    getUserPostingSlots(userId),
    repository.getPostsBetween(rangeStart, rangeEnd),
  ]);

  const accountIds = [...new Set(posts.flatMap((post) => post.accountIds))];
  const accounts =
    accountIds.length === 0
      ? []
      : await prisma.connectedAccount.findMany({
          where: { userId, id: { in: accountIds } },
          select: { id: true, platform: true },
        });
  const platformByAccount = new Map(accounts.map((account) => [account.id, account.platform]));
  const postsByMinute = new Map<string, typeof posts>();

  for (const post of posts) {
    if (!post.scheduledFor) continue;
    const key = localMinuteKey(post.scheduledFor, input.timeZone);
    const matching = postsByMinute.get(key) ?? [];
    matching.push(post);
    postsByMinute.set(key, matching);
  }

  const summary = {
    openSlotCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
    pastCount: 0,
  };
  const periodStartKey = formatCalendarDate(period.periodStart);
  const periodEndKey = formatCalendarDate(period.periodEnd);

  const days = enumerateDays(period.fetchStart, period.fetchEnd).map((date) => {
    const dateKey = formatCalendarDate(date);
    const entries: z.infer<typeof scheduleEntrySchema>[] = [];
    const postsForDay = posts.filter(
      (post) =>
        post.scheduledFor && formatCalendarDate(calendarDateForInstant(post.scheduledFor, input.timeZone)) === dateKey,
    );

    for (const post of postsForDay) {
      if (!post.scheduledFor) continue;
      const status = postStatus(post, now);
      const isPast = post.scheduledFor <= now;
      entries.push({
        id: `post:${post.id}`,
        kind: "post",
        at: post.scheduledFor.toISOString(),
        localTime: localTimeLabel(post.scheduledFor, input.timeZone),
        isPast,
        postId: post.id,
        message: post.message,
        status,
        platforms: [...new Set(post.accountIds.map((id) => platformByAccount.get(id)).filter(Boolean))] as string[],
        errorMessage: post.errorMessage ?? null,
      });

      if (dateKey >= periodStartKey && dateKey < periodEndKey) {
        if (status === "failed") summary.failedCount += 1;
        else if (status === "published") summary.publishedCount += 1;
        else summary.scheduledCount += 1;
        if (isPast) summary.pastCount += 1;
      }
    }

    for (const slot of slots) {
      const weekday = calendarDateToUtc(date).getUTCDay();
      if (!slot.weekdays.includes(weekday)) continue;
      const key = `${dateKey}T${slot.time}`;
      if (postsByMinute.has(key)) continue;
      const instant = zonedDateTimeToInstant(date, slot.time, input.timeZone);
      const isPast = instant <= now;
      entries.push({
        id: `slot:${key}`,
        kind: "slot",
        at: instant.toISOString(),
        localTime: localTimeLabel(instant, input.timeZone),
        isPast,
        postId: null,
        message: null,
        status: "open",
        platforms: [],
        errorMessage: null,
      });
      if (!isPast && dateKey >= periodStartKey && dateKey < periodEndKey) {
        summary.openSlotCount += 1;
      }
    }

    entries.sort((left, right) => left.at.localeCompare(right.at));
    return {
      date: dateKey,
      weekday: formatCalendarLabel(date, { weekday: "long" }),
      weekdayShort: formatCalendarLabel(date, { weekday: "short" }),
      dayNumber: date.day,
      inPeriod: dateKey >= periodStartKey && dateKey < periodEndKey,
      isToday: dateKey === formatCalendarDate(today),
      entries,
    };
  });

  return {
    kind: "schedule",
    view: input.view,
    anchorDate: formatCalendarDate(anchor),
    previousAnchorDate: formatCalendarDate(getNavigationAnchor(input.view, anchor, -1)),
    nextAnchorDate: formatCalendarDate(getNavigationAnchor(input.view, anchor, 1)),
    todayAnchorDate: formatCalendarDate(today),
    timeZone: input.timeZone,
    periodLabel: getPeriodLabel(input.view, period.periodStart, period.periodEnd),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    days,
    summary,
  };
}
