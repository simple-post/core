import {
  getSlotOccurrencesInRange,
  getUpcomingSlotOccurrences,
  hasEnabledSlots,
  parseSlotOccurrenceKey,
  parseSlotTime,
  slotOccurrenceKey,
} from "@/lib/posting-slots/occurrences";

describe("parseSlotTime", () => {
  it("parses valid HH:mm values", () => {
    expect(parseSlotTime("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseSlotTime("17:05")).toEqual({ hour: 17, minute: 5 });
    expect(parseSlotTime("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("rejects malformed or out-of-range values", () => {
    expect(parseSlotTime("24:00")).toBeNull();
    expect(parseSlotTime("12:60")).toBeNull();
    expect(parseSlotTime("9:00")).toBeNull();
    expect(parseSlotTime("")).toBeNull();
  });
});

describe("slotOccurrenceKey", () => {
  it("round-trips through parseSlotOccurrenceKey at minute precision", () => {
    const date = new Date(2026, 6, 6, 17, 0, 42, 500); // Monday, seconds/ms dropped
    const key = slotOccurrenceKey(date);

    expect(key).toBe("2026-07-06T17:00");
    expect(parseSlotOccurrenceKey(key)).toEqual(new Date(2026, 6, 6, 17, 0, 0, 0));
  });

  it("rejects malformed and impossible keys", () => {
    expect(parseSlotOccurrenceKey("2026-07-06")).toBeNull();
    expect(parseSlotOccurrenceKey("2026-07-06T24:00")).toBeNull();
    expect(parseSlotOccurrenceKey("2026-02-30T10:00")).toBeNull();
    expect(parseSlotOccurrenceKey("not-a-key")).toBeNull();
  });
});

describe("getSlotOccurrencesInRange", () => {
  // Mon Jul 6 2026 through Sun Jul 12 2026 (exclusive end on Jul 13).
  const weekStart = new Date(2026, 6, 6, 0, 0);
  const weekEnd = new Date(2026, 6, 13, 0, 0);

  it("expands weekday slots into local occurrences", () => {
    const occurrences = getSlotOccurrencesInRange([{ time: "17:00", weekdays: [1, 2, 3, 4, 5] }], weekStart, weekEnd);

    expect(occurrences).toHaveLength(5);
    expect(occurrences[0]).toEqual(new Date(2026, 6, 6, 17, 0));
    expect(occurrences[4]).toEqual(new Date(2026, 6, 10, 17, 0));
  });

  it("merges duplicate day/time pairs and sorts across slots", () => {
    const occurrences = getSlotOccurrencesInRange(
      [
        { time: "17:00", weekdays: [1] },
        { time: "17:00", weekdays: [1] },
        { time: "09:00", weekdays: [1] },
      ],
      weekStart,
      weekEnd,
    );

    expect(occurrences).toEqual([new Date(2026, 6, 6, 9, 0), new Date(2026, 6, 6, 17, 0)]);
  });

  it("treats the range as inclusive start, exclusive end", () => {
    const occurrences = getSlotOccurrencesInRange(
      [{ time: "00:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }],
      weekStart,
      weekEnd,
    );

    expect(occurrences[0]).toEqual(weekStart);
    expect(occurrences).toHaveLength(7);
    expect(occurrences.at(-1)).toEqual(new Date(2026, 6, 12, 0, 0));
  });

  it("ignores slots with invalid times", () => {
    expect(getSlotOccurrencesInRange([{ time: "25:00", weekdays: [1] }], weekStart, weekEnd)).toEqual([]);
  });
});

describe("getUpcomingSlotOccurrences", () => {
  const slots = [{ time: "17:00", weekdays: [1, 2, 3, 4, 5] }];

  it("returns occurrences strictly after the reference time", () => {
    const from = new Date(2026, 6, 6, 17, 0); // exactly at Monday's slot
    const upcoming = getUpcomingSlotOccurrences(slots, from, 3);

    expect(upcoming).toEqual([new Date(2026, 6, 7, 17, 0), new Date(2026, 6, 8, 17, 0), new Date(2026, 6, 9, 17, 0)]);
  });

  it("returns nothing when no weekdays are enabled", () => {
    expect(getUpcomingSlotOccurrences([{ time: "17:00", weekdays: [] }], new Date(2026, 6, 6), 5)).toEqual([]);
  });
});

describe("hasEnabledSlots", () => {
  it("requires at least one slot with an enabled weekday", () => {
    expect(hasEnabledSlots([])).toBe(false);
    expect(hasEnabledSlots([{ time: "17:00", weekdays: [] }])).toBe(false);
    expect(hasEnabledSlots([{ time: "17:00", weekdays: [3] }])).toBe(true);
  });
});
