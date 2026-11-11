/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement, useState } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { UiLocaleProvider } from "@/lib/i18n/client";
import { UiLanguageSelect } from "@/lib/i18n/language-select";
import { languageNames, localeLabel, locales, type Locale } from "@/lib/i18n/locales";

const mockRouter = { replace: jest.fn(), refresh: jest.fn() };
let mockQuery = "";
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(mockQuery),
}));
afterEach(cleanup);
const component = () =>
  createElement(UiLocaleProvider, {
    locale: "ar",
    messages: {},
    children: createElement(UiLanguageSelect),
  });
beforeEach(() => jest.clearAllMocks());
it("waits for navigation to remove the incoming locale before refreshing", () => {
  mockQuery = "ui_locale=ar&state=preserved";
  window.history.replaceState(null, "", `/?${mockQuery}#section`);
  const view = render(component());
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ja" } });
  expect(document.cookie).toContain("ui_locale=ja");
  expect(mockRouter.replace).toHaveBeenCalledWith("/?state=preserved#section", { scroll: false });
  expect(mockRouter.refresh).not.toHaveBeenCalled();
  mockQuery = "state=preserved";
  view.rerender(component());
  expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
});
it("refreshes directly when there is no incoming language hint", () => {
  mockQuery = "state=preserved";
  window.history.replaceState(null, "", `/?${mockQuery}`);
  render(component());
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ja" } });
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
});

it("shows only flags and uppercase locale codes with accessible native names", () => {
  const { container } = render(component());
  const select = screen.getByRole("combobox");
  expect(select.getAttribute("dir")).toBe("ltr");
  expect(select.getAttribute("title")).toBe(languageNames.ar);
  expect(container.querySelector("label.locale-control svg[aria-hidden='true'] ellipse")).not.toBeNull();
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(locales.map(localeLabel));
  for (const locale of locales) {
    expect(screen.getByRole("option", { name: languageNames[locale] }).getAttribute("value")).toBe(locale);
  }
});

function Draft() {
  const [content, setContent] = useState("");
  return createElement("textarea", {
    "aria-label": "Draft",
    value: content,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value),
  });
}
it("keeps authored draft state mounted while the server translations refresh", () => {
  const withLocale = (locale: Locale) =>
    createElement(UiLocaleProvider, {
      locale,
      messages: {},
      children: createElement("form", null, createElement(Draft), createElement(UiLanguageSelect)),
    });
  mockQuery = "state=preserved";
  window.history.replaceState(null, "", "/?state=preserved#draft");
  const view = render(withLocale("ar"));
  const draft = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "My original caption العربية 日本語" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ja" } });
  view.rerender(withLocale("ja"));
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.value).toBe("My original caption العربية 日本語");
  expect(window.location.search + window.location.hash).toBe("?state=preserved#draft");
  expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
});
