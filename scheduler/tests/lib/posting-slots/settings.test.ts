import { normalizePostingSlots, postingSlotsRequestSchema } from "@/lib/posting-slots/settings";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("normalizePostingSlots", () => {
  it("merges duplicate times, dedupes weekdays, and sorts everything", () => {
    const normalized = normalizePostingSlots([
      { time: "17:00", weekdays: [5, 1, 1] },
      { time: "09:00", weekdays: [2] },
      { time: "17:00", weekdays: [3, 5] },
    ]);

    expect(normalized).toEqual([
      { time: "09:00", weekdays: [2] },
      { time: "17:00", weekdays: [1, 3, 5] },
    ]);
  });

  it("keeps slots with no enabled weekdays", () => {
    expect(normalizePostingSlots([{ time: "12:00", weekdays: [] }])).toEqual([{ time: "12:00", weekdays: [] }]);
  });
});

describe("postingSlotsRequestSchema", () => {
  it("accepts a valid slot list", () => {
    const parsed = postingSlotsRequestSchema.parse({
      slots: [{ time: "05:30", weekdays: [0, 6] }],
    });

    expect(parsed.slots).toEqual([{ time: "05:30", weekdays: [0, 6] }]);
  });

  it("rejects malformed times and out-of-range weekdays", () => {
    expect(() => postingSlotsRequestSchema.parse({ slots: [{ time: "24:00", weekdays: [1] }] })).toThrow();
    expect(() => postingSlotsRequestSchema.parse({ slots: [{ time: "9:00", weekdays: [1] }] })).toThrow();
    expect(() => postingSlotsRequestSchema.parse({ slots: [{ time: "09:00", weekdays: [7] }] })).toThrow();
  });
});
