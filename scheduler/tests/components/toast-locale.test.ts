/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { UiLocaleProvider } from "@/lib/i18n/client";

jest.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark" }) }));
afterEach(() => {
  toast.dismiss();
  cleanup();
});
it("localizes notification-region and close-button accessibility through the supported Sonner API", async () => {
  render(
    createElement(UiLocaleProvider, {
      locale: "ar",
      messages: { Notifications: "NOTICE_AR", "Close toast": "CLOSE_AR" },
      children: createElement(Toaster, { closeButton: true }),
    }),
  );
  await act(async () => {
    toast("unchanged العربية 日本語", { duration: Infinity });
  });
  expect(screen.getByRole("region", { name: /NOTICE_AR/ })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "CLOSE_AR" })).toBeTruthy();
  expect(screen.getByText("unchanged العربية 日本語")).toBeTruthy();
  expect(document.querySelector('[dir="rtl"]')).not.toBeNull();
});
