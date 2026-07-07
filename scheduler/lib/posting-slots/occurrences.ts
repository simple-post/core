// Pure helpers for expanding weekly posting slots ("HH:mm" + weekdays) into
// concrete local-time Date occurrences. Shared by the schedule picker and the
// dashboard calendar; safe to import from client components.

export interface PostingSlotConfig {
  time: string; // "HH:mm" (24h), local wall-clock time
  weekdays: number[]; // 0 = Sunday … 6 = Saturday (JS Date#getDay)
}

// Monday-first display order used by the settings table and calendar,
// mapped to JS Date#getDay values.
export const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
] as const;

export function parseSlotTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

// Minute-precision key ("2026-07-06T17:00") used to match a post's
// scheduled time against a slot occurrence, and as a URL-safe value for
// prefilling the create-post form from the calendar.
export function slotOccurrenceKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function parseSlotOccurrenceKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(key);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const isValid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;

  return isValid ? date : null;
}

// All slot occurrences with rangeStart <= occurrence < rangeEnd, sorted and
// deduplicated (two slots at the same time on the same day collapse to one).
export function getSlotOccurrencesInRange(slots: PostingSlotConfig[], rangeStart: Date, rangeEnd: Date): Date[] {
  const occurrences = new Map<string, Date>();
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());

  while (cursor < rangeEnd) {
    for (const slot of slots) {
      if (!slot.weekdays.includes(cursor.getDay())) continue;

      const time = parseSlotTime(slot.time);
      if (!time) continue;

      const occurrence = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), time.hour, time.minute);
      if (occurrence >= rangeStart && occurrence < rangeEnd) {
        occurrences.set(slotOccurrenceKey(occurrence), occurrence);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return [...occurrences.values()].sort((a, b) => a.getTime() - b.getTime());
}

// The next `count` upcoming occurrences strictly after `from`, looking at
// most `maxDays` ahead so a slot config with no enabled weekdays terminates.
export function getUpcomingSlotOccurrences(
  slots: PostingSlotConfig[],
  from: Date,
  count: number,
  maxDays = 60,
): Date[] {
  const rangeStart = new Date(from.getTime() + 60 * 1000);
  const rangeEnd = new Date(from.getTime() + maxDays * 24 * 60 * 60 * 1000);
  return getSlotOccurrencesInRange(slots, rangeStart, rangeEnd).slice(0, count);
}

export function hasEnabledSlots(slots: PostingSlotConfig[]): boolean {
  return slots.some((slot) => slot.weekdays.length > 0);
}
