import { timeZoneSchema } from "@/lib/preferences/publishing";
import { localDateTime, scheduledInstant } from "@/mcp-ui/extensions/timezone";

it("round trips in the chosen timezone independently of machine time", () => {
  expect(scheduledInstant("2026-09-29T16:30", "Europe/Berlin")).toBe("2026-09-29T14:30:00.000Z");
  expect(localDateTime(new Date("2026-09-29T14:30:00Z"), "Asia/Kathmandu")).toBe("2026-09-29T20:15");
  expect(scheduledInstant("2026-09-29T20:15", "Asia/Kathmandu")).toBe("2026-09-29T14:30:00.000Z");
});
it("rejects skipped and ambiguous local times at DST boundaries", () => {
  expect(() => scheduledInstant("2026-03-29T02:30", "Europe/Berlin")).toThrow("does not exist");
  expect(() => scheduledInstant("2026-10-25T02:30", "Europe/Berlin")).toThrow("occurs twice");
});
it("rejects invalid dates and timezones", () => {
  expect(() => scheduledInstant("2026-02-30T12:00", "UTC")).toThrow("valid date");
  expect(timeZoneSchema.safeParse("Mars/Olympus").success).toBe(false);
});
