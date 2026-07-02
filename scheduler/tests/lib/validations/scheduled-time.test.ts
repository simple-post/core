import {
  SCHEDULED_TIME_INVALID_MESSAGE,
  SCHEDULED_TIME_PAST_MESSAGE,
  SCHEDULED_TIME_REQUIRED_MESSAGE,
  getLocalScheduledDateTimeError,
  getScheduledForValueError,
  parseLocalScheduledDateTime,
} from "@/lib/validations/scheduled-time";

describe("scheduled-time validation", () => {
  it("parses valid local date and time values", () => {
    const scheduledFor = parseLocalScheduledDateTime("2026-07-01", "09:30");

    expect(scheduledFor).not.toBeNull();
    expect(scheduledFor?.getFullYear()).toBe(2026);
    expect(scheduledFor?.getMonth()).toBe(6);
    expect(scheduledFor?.getDate()).toBe(1);
    expect(scheduledFor?.getHours()).toBe(9);
    expect(scheduledFor?.getMinutes()).toBe(30);
  });

  it("rejects missing, invalid, and past local date/time selections", () => {
    const now = new Date(2026, 6, 1, 12, 0, 0, 0);

    expect(getLocalScheduledDateTimeError("", "09:30", now)).toBe(SCHEDULED_TIME_REQUIRED_MESSAGE);
    expect(getLocalScheduledDateTimeError("2026-02-30", "09:30", now)).toBe(SCHEDULED_TIME_INVALID_MESSAGE);
    expect(getLocalScheduledDateTimeError("2026-07-01", "12:00", now)).toBe(SCHEDULED_TIME_PAST_MESSAGE);
    expect(getLocalScheduledDateTimeError("2026-07-01", "12:01", now)).toBeNull();
  });

  it("rejects missing, invalid, and past ISO scheduledFor values", () => {
    const now = new Date("2026-07-01T12:00:00.000Z");

    expect(getScheduledForValueError(undefined, now)).toBe(SCHEDULED_TIME_REQUIRED_MESSAGE);
    expect(getScheduledForValueError("not-a-date", now)).toBe("scheduledFor must be a valid ISO 8601 datetime.");
    expect(getScheduledForValueError("2026-07-01T12:00:00.000Z", now)).toBe(SCHEDULED_TIME_PAST_MESSAGE);
    expect(getScheduledForValueError("2026-07-01T12:01:00.000Z", now)).toBeNull();
  });
});
