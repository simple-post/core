import { bucketStarts, localWeekdayHour, resolvePeriod } from "@/lib/post-analytics/periods";

const now = new Date("2026-11-21T15:30:00Z"); // Saturday

describe("resolvePeriod", () => {
  it("resolves rolling periods ending now", () => {
    const period = resolvePeriod({ period: "last_7d", now });
    expect(period.start.toISOString()).toBe("2026-11-14T15:30:00.000Z");
    expect(period.end).toEqual(now);
    expect(period.previous).toEqual({ start: new Date("2026-11-07T15:30:00Z"), end: period.start });
    expect(period.granularity).toBe("day");
    expect(resolvePeriod({ period: "last_24h", now }).granularity).toBe("hour");
  });

  it("resolves calendar periods in the requested timezone", () => {
    const week = resolvePeriod({ period: "this_week", now, timeZone: "Europe/Berlin" });
    expect(week.start.toISOString()).toBe("2026-11-15T23:00:00.000Z"); // Monday 00:00 CET
    expect(week.previous?.start.toISOString()).toBe("2026-11-08T23:00:00.000Z");
    // Week-to-date compares with the same elapsed span of the previous week.
    expect(week.previous?.end.toISOString()).toBe("2026-11-14T15:30:00.000Z");

    const lastMonth = resolvePeriod({ period: "last_month", now, timeZone: "America/New_York" });
    expect(lastMonth.start.toISOString()).toBe("2026-10-01T04:00:00.000Z"); // EDT
    expect(lastMonth.end.toISOString()).toBe("2026-11-01T04:00:00.000Z");

    const year = resolvePeriod({ period: "this_year", now, timeZone: "UTC" });
    expect(year.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(year.previous).toEqual({ start: new Date("2025-01-01T00:00:00Z"), end: new Date("2025-11-21T15:30:00Z") });
    expect(year.granularity).toBe("week");
  });

  it("treats a date-only custom end as inclusive and rejects inverted ranges", () => {
    const custom = resolvePeriod({ from: "2026-11-01", to: "2026-11-03", timeZone: "UTC", now });
    expect(custom.period).toBe("custom");
    expect(custom.end.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(() => resolvePeriod({ from: "2026-11-05", to: "2026-11-01", now })).toThrow("after its start");
  });

  it("falls back to UTC for unknown timezones and starts all_time at the first post", () => {
    const period = resolvePeriod({
      period: "all_time",
      timeZone: "Mars/Olympus",
      now,
      earliest: new Date("2025-03-01Z"),
    });
    expect(period.timeZone).toBe("UTC");
    expect(period.start.toISOString()).toBe("2025-03-01T00:00:00.000Z");
    expect(period.previous).toBeNull();
    expect(period.granularity).toBe("month");
  });

  it("never produces more than ~400 buckets", () => {
    expect(resolvePeriod({ period: "last_365d", granularity: "hour", now }).granularity).toBe("day");
    expect(
      resolvePeriod({ period: "all_time", granularity: "day", now, earliest: new Date("2022-01-01Z") }).granularity,
    ).toBe("week");
  });
});

describe("buckets", () => {
  it("creates local day buckets across a DST change", () => {
    const buckets = bucketStarts(
      new Date("2026-10-24T22:00:00Z"),
      new Date("2026-10-27T23:00:00Z"),
      "day",
      "Europe/Berlin",
    );
    expect(buckets.map((bucket) => bucket.toISOString())).toEqual([
      "2026-10-24T22:00:00.000Z", // Oct 25 00:00 CEST (clocks change at 03:00)
      "2026-10-25T23:00:00.000Z", // Oct 26 00:00 CET
      "2026-10-26T23:00:00.000Z",
    ]);
  });

  it("reports local weekday (Monday = 0) and hour", () => {
    expect(localWeekdayHour(new Date("2026-11-16T07:00:00Z"), "Asia/Tokyo")).toEqual({ weekday: 0, hour: 16 });
  });
});
