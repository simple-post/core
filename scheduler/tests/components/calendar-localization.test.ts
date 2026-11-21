/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { cleanup, render, screen } from "@testing-library/react";

import { ScheduleDateTimePicker } from "@/components/schedule-date-time-picker";
import { Calendar } from "@/components/ui/calendar";
import { calendarLabels } from "@/lib/i18n/calendar";
import { UiLocaleProvider } from "@/lib/i18n/client";
import { sourceCopy } from "@/lib/i18n/source-copy";

jest.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }));
afterEach(cleanup);
it("renders calendar locale and direction while date selection remains a Date", () => {
  const date = new Date(2099, 4, 20);
  render(
    createElement(UiLocaleProvider, {
      locale: "ar",
      messages: { "Next month": "NEXT_AR", "Previous month": "PREV_AR" },
      children: createElement(Calendar, { mode: "single", defaultMonth: date, selected: date }),
    }),
  );
  expect(screen.getByRole("button", { name: "NEXT_AR" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "PREV_AR" })).toBeTruthy();
  expect(document.querySelector('[dir="rtl"]')).not.toBeNull();
  expect(document.body.textContent).toContain(new Intl.DateTimeFormat("ar", { month: "long" }).format(date));
  expect(calendarLabels("ja", sourceCopy).labelGrid!(date)).toBe(
    new Intl.DateTimeFormat("ja", { month: "long", year: "numeric" }).format(date),
  );
});
it("changes date display language without rewriting the selected scheduling values", () => {
  const onDate = jest.fn();
  const onTime = jest.fn();
  const picker = createElement(ScheduleDateTimePicker, {
    scheduledDate: "2099-05-20",
    scheduledTime: "09:30",
    onScheduledDateChange: onDate,
    onScheduledTimeChange: onTime,
  });
  const { rerender, container } = render(
    createElement(UiLocaleProvider, { locale: "ja", messages: {}, children: picker }),
  );
  const before = container.textContent;
  rerender(createElement(UiLocaleProvider, { locale: "ar", messages: {}, children: picker }));
  expect(container.textContent).not.toBe(before);
  expect(onDate).not.toHaveBeenCalled();
  expect(onTime).not.toHaveBeenCalled();
});
