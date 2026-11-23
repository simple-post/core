import { ar, bg, de, enUS, es, fr, hi, id, it, ja, ko, ptBR, tr, zhCN, zhTW } from "date-fns/locale";

import type { Locale } from "./locales";
import type { SourceCopy } from "./source-copy";
import type { Labels } from "react-day-picker";

export const calendarLocales = {
  en: enUS,
  es,
  "pt-BR": ptBR,
  fr,
  de,
  ja,
  it,
  ko,
  "zh-Hans": zhCN,
  "zh-Hant": zhTW,
  ar,
  hi,
  id,
  tr,
  bg,
} satisfies Record<Locale, typeof enUS>;

export function calendarLabels(locale: Locale, copy: SourceCopy): Partial<Labels> {
  const fullDate = (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date);
  return {
    labelNav: () => copy("Calendar navigation"),
    labelNext: () => copy("Next month"),
    labelPrevious: () => copy("Previous month"),
    labelMonthDropdown: () => copy("Choose month"),
    labelYearDropdown: () => copy("Choose year"),
    labelWeekNumber: (week) => copy("Week {{week, number}}", { week }),
    labelWeekNumberHeader: () => copy("Week number"),
    labelWeekday: (date) => new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date),
    labelGrid: (date) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date),
    labelGridcell: (date) => fullDate(date),
    labelDayButton: (date, modifiers) =>
      modifiers.today && modifiers.selected
        ? copy("Today, {{date}}, selected", { date: fullDate(date) })
        : modifiers.today
          ? copy("Today, {{date}}", { date: fullDate(date) })
          : modifiers.selected
            ? copy("{{date}}, selected", { date: fullDate(date) })
            : fullDate(date),
  };
}
