/**
 * Reporting periods for analytics summaries. Calendar periods ("this week",
 * "last month", …) are resolved in the caller's IANA timezone; rolling periods
 * ("last 7 days") are exact durations ending now.
 */

export const ANALYTICS_PERIODS = [
  "last_24h",
  "last_7d",
  "last_30d",
  "last_90d",
  "last_365d",
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "all_time",
  "custom",
] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const ANALYTICS_GRANULARITIES = ["hour", "day", "week", "month"] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

export interface ResolvedPeriod {
  period: AnalyticsPeriod;
  timeZone: string;
  /** Inclusive start. */
  start: Date;
  /** Exclusive end. */
  end: Date;
  /** The equally long period immediately before, for comparisons. Null for all_time. */
  previous: { start: Date; end: Date } | null;
  granularity: AnalyticsGranularity;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Periods that end now; their comparison uses the same elapsed span of the previous period. */
const TO_DATE_PERIODS = new Set<AnalyticsPeriod>(["today", "this_week", "this_month", "this_quarter", "this_year"]);

/** Earliest instant used for "all time" (SimplePost did not exist before this). */
export const ALL_TIME_START = new Date("2020-01-01T00:00:00Z");

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

export function calendarDateFor(instant: Date, timeZone: string): CalendarDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

/** The instant at which the given local calendar date starts in `timeZone`. */
export function startOfLocalDay(date: CalendarDate, timeZone: string): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const difference = target - actualAsUtc;
    if (difference === 0) break;
    guess += difference;
  }
  return new Date(guess);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function addMonths(date: CalendarDate, months: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: 1 };
}

/** ISO weeks start on Monday. */
export function startOfWeek(date: CalendarDate): CalendarDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function startOfQuarter(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month - ((date.month - 1) % 3), day: 1 };
}

export function formatCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Parses YYYY-MM-DD (local midnight in timeZone) or a full ISO datetime. */
export function parseBoundary(value: string, timeZone: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    return startOfLocalDay({ year, month, day }, timeZone);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

export function defaultGranularity(start: Date, end: Date): AnalyticsGranularity {
  const span = end.getTime() - start.getTime();
  if (span <= 2 * DAY) return "hour";
  if (span <= 92 * DAY) return "day";
  if (span <= 400 * DAY) return "week";
  return "month";
}

/** Caps the number of buckets so an over-fine granularity can't explode a response. */
function boundedGranularity(requested: AnalyticsGranularity, start: Date, end: Date): AnalyticsGranularity {
  const span = end.getTime() - start.getTime();
  const order: AnalyticsGranularity[] = ["hour", "day", "week", "month"];
  const approximate: Record<AnalyticsGranularity, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY };
  let index = order.indexOf(requested);
  while (index < order.length - 1 && span / approximate[order[index]] > 400) index += 1;
  return order[index];
}

export function resolvePeriod(params: {
  period?: AnalyticsPeriod;
  from?: string;
  to?: string;
  timeZone?: string;
  granularity?: AnalyticsGranularity;
  now?: Date;
  /** First publish time of the user's posts, used to start "all_time". */
  earliest?: Date | null;
}): ResolvedPeriod {
  const now = params.now ?? new Date();
  const timeZone = params.timeZone && isValidTimeZone(params.timeZone) ? params.timeZone : "UTC";
  const period: AnalyticsPeriod = params.from || params.to ? "custom" : (params.period ?? "last_30d");
  const today = calendarDateFor(now, timeZone);
  const local = (date: CalendarDate) => startOfLocalDay(date, timeZone);

  let start: Date;
  let end: Date = now;
  let previous: ResolvedPeriod["previous"] | undefined;

  switch (period) {
    case "last_24h": {
      start = new Date(now.getTime() - DAY);
      break;
    }
    case "last_7d":
    case "last_30d":
    case "last_90d":
    case "last_365d": {
      const days = Number(period.slice(5, -1));
      start = new Date(now.getTime() - days * DAY);
      break;
    }
    case "today": {
      start = local(today);
      previous = { start: local(addDays(today, -1)), end: start };
      break;
    }
    case "yesterday": {
      start = local(addDays(today, -1));
      end = local(today);
      break;
    }
    case "this_week": {
      const monday = startOfWeek(today);
      start = local(monday);
      previous = { start: local(addDays(monday, -7)), end: start };
      break;
    }
    case "last_week": {
      const monday = startOfWeek(today);
      start = local(addDays(monday, -7));
      end = local(monday);
      break;
    }
    case "this_month": {
      const first = { year: today.year, month: today.month, day: 1 };
      start = local(first);
      previous = { start: local(addMonths(first, -1)), end: start };
      break;
    }
    case "last_month": {
      const first = { year: today.year, month: today.month, day: 1 };
      start = local(addMonths(first, -1));
      end = local(first);
      previous = { start: local(addMonths(first, -2)), end: start };
      break;
    }
    case "this_quarter": {
      const first = startOfQuarter(today);
      start = local(first);
      previous = { start: local(addMonths(first, -3)), end: start };
      break;
    }
    case "last_quarter": {
      const first = startOfQuarter(today);
      start = local(addMonths(first, -3));
      end = local(first);
      previous = { start: local(addMonths(first, -6)), end: start };
      break;
    }
    case "this_year": {
      const first = { year: today.year, month: 1, day: 1 };
      start = local(first);
      previous = { start: local({ year: today.year - 1, month: 1, day: 1 }), end: start };
      break;
    }
    case "last_year": {
      start = local({ year: today.year - 1, month: 1, day: 1 });
      end = local({ year: today.year, month: 1, day: 1 });
      previous = { start: local({ year: today.year - 2, month: 1, day: 1 }), end: start };
      break;
    }
    case "all_time": {
      start = params.earliest && params.earliest < now ? params.earliest : ALL_TIME_START;
      previous = null;
      break;
    }
    case "custom": {
      start = params.from ? parseBoundary(params.from, timeZone) : new Date(now.getTime() - 30 * DAY);
      if (params.to) {
        end = parseBoundary(params.to, timeZone);
        // A date-only "to" is inclusive of that whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(params.to)) end = new Date(end.getTime() + DAY);
      }
      if (end.getTime() <= start.getTime()) throw new Error("The period end must be after its start.");
      break;
    }
  }

  if (previous === undefined) {
    const span = end.getTime() - start.getTime();
    previous = { start: new Date(start.getTime() - span), end: start };
  } else if (previous && TO_DATE_PERIODS.has(period)) {
    // "This month so far" is compared with the same elapsed span of last month,
    // not with the whole previous month.
    const elapsed = end.getTime() - start.getTime();
    previous = {
      start: previous.start,
      end: new Date(Math.min(previous.end.getTime(), previous.start.getTime() + elapsed)),
    };
  }

  return {
    period,
    timeZone,
    start,
    end,
    previous,
    granularity: boundedGranularity(params.granularity ?? defaultGranularity(start, end), start, end),
  };
}

/** Bucket key (local time) for an instant: "2026-11-21T14", "2026-11-21", "2026-W47" style keys use the bucket's start date. */
export function bucketStart(instant: Date, granularity: AnalyticsGranularity, timeZone: string): Date {
  const date = calendarDateFor(instant, timeZone);
  switch (granularity) {
    case "hour": {
      const parts = zonedParts(instant, timeZone);
      return new Date(startOfLocalDay(date, timeZone).getTime() + parts.hour * HOUR);
    }
    case "day": {
      return startOfLocalDay(date, timeZone);
    }
    case "week": {
      return startOfLocalDay(startOfWeek(date), timeZone);
    }
    case "month": {
      return startOfLocalDay({ year: date.year, month: date.month, day: 1 }, timeZone);
    }
  }
}

/** All bucket starts covering [start, end). */
export function bucketStarts(start: Date, end: Date, granularity: AnalyticsGranularity, timeZone: string): Date[] {
  const buckets: Date[] = [];
  let cursor = bucketStart(start, granularity, timeZone);
  let guard = 0;
  while (cursor.getTime() < end.getTime() && guard < 1000) {
    buckets.push(cursor);
    const date = calendarDateFor(cursor, timeZone);
    switch (granularity) {
      case "hour": {
        cursor = bucketStart(new Date(cursor.getTime() + HOUR), "hour", timeZone);
        // DST fall-back can map two hours onto one local hour; always advance.
        if (cursor.getTime() <= buckets.at(-1)!.getTime()) cursor = new Date(buckets.at(-1)!.getTime() + HOUR);
        break;
      }
      case "day": {
        cursor = startOfLocalDay(addDays(date, 1), timeZone);
        break;
      }
      case "week": {
        cursor = startOfLocalDay(addDays(date, 7), timeZone);
        break;
      }
      case "month": {
        cursor = startOfLocalDay(addMonths(date, 1), timeZone);
        break;
      }
    }
    guard += 1;
  }
  return buckets;
}

/** Local weekday (0 = Monday … 6 = Sunday) and hour (0–23) of an instant. */
export function localWeekdayHour(instant: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = zonedParts(instant, timeZone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { weekday: (weekday + 6) % 7, hour: parts.hour };
}
