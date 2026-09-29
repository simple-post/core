export function localDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

// Search actual zone offsets rather than relying on the process or browser timezone.
export function scheduledInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a date and time.");
  const wall = new Date(`${value}:00Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== value)
    throw new Error("Choose a valid date and time.");
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(wall.getTime() + offset * 60_000);
    if (localDateTime(instant, timeZone) === value) matches.push(instant.toISOString());
  }
  if (matches.length === 0)
    throw new Error("This local time does not exist because the clocks change. Choose another time.");
  if (matches.length > 1)
    throw new Error(
      "This local time occurs twice because the clocks change. Choose an unambiguous time, or ask to schedule with an explicit UTC offset.",
    );
  return matches[0];
}
