/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ApiKeysPage from "@/app/(protected)/api-keys/page";
import { UiLocaleProvider } from "@/lib/i18n/client";
import arabic from "@/lib/i18n/messages/ar.json";

jest.mock("@/components/navbar", () => ({ Navbar: () => null }));
jest.mock("@/lib/logger/client", () => ({ logClientError: jest.fn() }));

it("localizes the suggested key name without changing the stored default or an entered name", async () => {
  const key = {
    id: "fixture-key",
    name: "مفتاح فريق API",
    keyPrefix: "sp_fixture",
    active: true,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  };
  const requests: unknown[] = [];
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === "POST") {
      requests.push(JSON.parse(String(options.body)));
      return { ok: true, json: async () => ({ apiKey: "fixture-token", key }) } as Response;
    }
    return { ok: true, json: async () => ({ keys: [key] }) } as Response;
  });

  try {
    render(createElement(UiLocaleProvider, { locale: "ar", messages: arabic, children: createElement(ApiKeysPage) }));
    await screen.findByText(key.name);
    const name = screen.getByLabelText(arabic.keyName);
    expect((name as HTMLInputElement).value).toBe(arabic.defaultApiKey);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: arabic.createApiKey }));
    });
    fireEvent.change(name, { target: { value: "הפקה · أصل" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: arabic.createApiKey }));
    });
    await waitFor(() => expect(requests).toEqual([{ name: "Default API key" }, { name: "הפקה · أصل" }]));
    expect((screen.getByLabelText(arabic.apiKey) as HTMLInputElement).value).toBe("fixture-token");
  } finally {
    global.fetch = originalFetch;
  }
});
