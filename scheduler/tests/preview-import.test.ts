/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PreviewImport } from "@/components/preview-import";
import { trackEvent } from "@/lib/analytics/plausible";
import { PREVIEW_KEY, PREVIEW_TTL } from "@/lib/preview/handoff";

const mockParams = new URLSearchParams("preview=fixture");
const mockRouter = { replace: jest.fn() };
const mockDraft = {
  isHydrated: true,
  hasDraftContent: false,
  resetDraft: jest.fn(),
  setMessage: jest.fn(),
  setThread: jest.fn(),
  setPostingMode: jest.fn(),
  setRepostSettings: jest.fn(),
};
jest.mock("next/navigation", () => ({ useSearchParams: () => mockParams, useRouter: () => mockRouter }));
jest.mock("@/components/post-draft-context", () => ({ usePostDraft: () => mockDraft }));
jest.mock("@/lib/analytics/plausible", () => ({ trackEvent: jest.fn() }));
jest.mock("@/lib/config", () => ({
  getPlatformName: (platform: string) => platform,
  isSocialPlatformEnabled: () => true,
}));

const preview = {
  version: 1,
  hasMedia: true,
  source: "post-preview",
  draftOrigin: "example",
  variants: [
    { platform: "x", message: "A fictional draft 🌍", thread: ["Second post"] },
    { platform: "bluesky", message: "Another version", thread: [] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockParams.set("preview", "fixture");
  mockDraft.hasDraftContent = false;
  mockDraft.isHydrated = true;
  localStorage.setItem(`${PREVIEW_KEY}fixture`, JSON.stringify({ preview, expiresAt: Date.now() + PREVIEW_TTL }));
});
afterEach(cleanup);

it("requires explicit confirmation before replacing an unsaved composer draft", () => {
  mockDraft.hasDraftContent = true;
  render(createElement(PreviewImport));
  const button = screen.getByRole("button", { name: "Use this draft" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mockDraft.resetDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Replace my current unsaved composer draft" }));
  fireEvent.click(button);
  expect(mockDraft.setMessage).toHaveBeenCalledWith("A fictional draft 🌍");
  expect(mockDraft.setThread).toHaveBeenCalledWith([{ message: "Second post" }]);
  expect(mockDraft.setPostingMode).toHaveBeenCalledWith("draft");
  expect(trackEvent).toHaveBeenCalledWith("Preview Draft Imported", {
    platform: "x",
    source: "post-preview",
    draft_origin: "example",
  });
});

it("imports once for rapid repeated clicks and allows another explicitly selected version", () => {
  render(createElement(PreviewImport));
  const button = screen.getByRole("button", { name: "Use this draft" });
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(mockDraft.resetDraft).toHaveBeenCalledTimes(1);
  expect(trackEvent).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "Draft imported" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Platform version" }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(mockDraft.setMessage).toHaveBeenLastCalledWith("Another version");
  expect(trackEvent).toHaveBeenCalledTimes(2);
});

it("does not import an expired transfer or send a conversion event", () => {
  localStorage.setItem(`${PREVIEW_KEY}fixture`, JSON.stringify({ preview, expiresAt: Date.now() - 1 }));
  render(createElement(PreviewImport));
  expect(screen.getByRole("alert").textContent).toMatch(/expired/i);
  expect(screen.queryByRole("button", { name: "Use this draft" })).toBeNull();
  expect(trackEvent).not.toHaveBeenCalled();
});

it("waits for composer hydration and displays the media transfer reminder", () => {
  mockDraft.isHydrated = false;
  render(createElement(PreviewImport));
  expect((screen.getByRole("button", { name: "Use this draft" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Upload your media again below/)).toBeTruthy();
  expect(trackEvent).not.toHaveBeenCalled();
});
