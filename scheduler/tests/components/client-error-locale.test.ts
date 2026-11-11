/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement, type ReactNode } from "react";

import { renderHook } from "@testing-library/react";

import { useDeletePost, useSubmitPost } from "@/hooks/use-mutations";
import { UiLocaleProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/locales";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (options: unknown) => options,
}));

function wrapper(locale: Locale, marker: string) {
  return function Provider({ children }: { children: ReactNode }) {
    return createElement(UiLocaleProvider, {
      locale,
      messages: { "Failed to delete post": marker },
      children,
    });
  };
}

afterEach(() => jest.restoreAllMocks());

it("isolates client fallback copy per provider while retaining the exact request", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: false });
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const first = renderHook(() => useDeletePost(), { wrapper: wrapper("ar", "first-marker") });
    const second = renderHook(() => useDeletePost(), { wrapper: wrapper("ja", "second-marker") });
    const invoke = (value: unknown) => (value as { mutationFn(id: string): Promise<void> }).mutationFn("post-42");
    await expect(invoke(first.result.current)).rejects.toThrow("first-marker");
    await expect(invoke(second.result.current)).rejects.toThrow("second-marker");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/posts/post-42", { method: "DELETE" }],
      ["/api/v1/posts/post-42", { method: "DELETE" }],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

it("preserves authored post payloads and provider error detail", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "provider-detail العربية" }) });
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const hook = renderHook(() => useSubmitPost(), { wrapper: wrapper("ar", "unused-marker") });
    const body = { message: "My unchanged 日本語 post", accountIds: ["account-1"], postingMode: "draft" };
    const mutation = hook.result.current as unknown as { mutationFn(value: unknown): Promise<unknown> };
    await expect(mutation.mutationFn({ body, mode: "create" })).rejects.toThrow("provider-detail العربية");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  } finally {
    global.fetch = originalFetch;
  }
});
