/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { UiLocaleProvider } from "@/lib/i18n/client";
import { UiLanguageSelect } from "@/lib/i18n/language-select";

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
