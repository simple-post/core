import type { Locale } from "./locales";
import type { createTranslator, MessageKey } from "./translate";

const postStatusKeys = {
  draft: "postDraft",
  scheduled: "postScheduled",
  pending: "postPending",
  published: "postPublished",
  failed: "postFailed",
} satisfies Record<string, MessageKey>;

export function localizedPostStatus(status: string, t: ReturnType<typeof createTranslator>) {
  const key = status.toLowerCase();
  return Object.hasOwn(postStatusKeys, key) ? t(postStatusKeys[key as keyof typeof postStatusKeys]) : status;
}

export function localizedSchedulePeriod(
  data: {
    view: "day" | "week" | "month";
    periodLabel: string;
    days: Array<{ date: string; inPeriod: boolean }>;
  },
  locale: Locale,
) {
  if (locale === "en") return data.periodLabel;
  // Treat values as dates already in the user's chosen schedule timezone.
  const dates = data.days.filter(({ inPeriod }) => inPeriod).map(({ date }) => date);
  if (dates.length === 0) return data.periodLabel;
  const first = new Date(dates[0] + "T00:00:00Z");
  const last = new Date(dates.at(-1) + "T00:00:00Z");
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return data.periodLabel;
  const formatter = new Intl.DateTimeFormat(
    locale,
    data.view === "month"
      ? { month: "long", year: "numeric", timeZone: "UTC" }
      : { dateStyle: "long", timeZone: "UTC" },
  );
  return data.view === "week" ? formatter.formatRange(first, last) : formatter.format(first);
}
