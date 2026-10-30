/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AssistantSelector } from "@/components/assistant-selector";
import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";

let mockState = {
  hasConnectedAccount: false,
  hasAiConnection: false,
  hasPost: false,
  hasPublishedPost: false,
};
let mockReadOnly = false;
const mockDismiss = jest.fn();
jest.mock("@/hooks/use-billing", () => ({ useWorkspaceReadOnly: () => mockReadOnly }));
jest.mock("@/components/onboarding/use-onboarding", () => ({
  useOnboardingState: () => ({ data: mockState }),
  useOnboardingDismissal: () => ({ dismissed: false, ready: true, dismiss: mockDismiss }),
}));

beforeEach(() => {
  mockState = { hasConnectedAccount: false, hasAiConnection: false, hasPost: false, hasPublishedPost: false };
  mockReadOnly = false;
  jest.clearAllMocks();
});
afterEach(cleanup);

it("starts with three concise steps and no automatic dialog", () => {
  render(createElement(OnboardingChecklist));
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("link", { name: "Connect" }).getAttribute("href")).toBe("/accounts?onboarding=connect");
  expect(screen.getByRole("link", { name: "Compose" }).getAttribute("href")).toBe("/schedule");
  expect(screen.queryByText(/Confirm your first|Works with|Link X/)).toBeNull();
});

it("recognizes an assistant-first signup and still offers account connection", () => {
  mockState.hasAiConnection = true;
  render(createElement(OnboardingChecklist));
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  expect(screen.getByRole("link", { name: "Connect" })).toBeTruthy();
  expect(screen.getAllByLabelText("Complete")).toHaveLength(1);
});

it("puts AI installation third without an optional label and keeps it visible after the first published post", () => {
  mockState = { hasConnectedAccount: true, hasAiConnection: false, hasPost: true, hasPublishedPost: true };
  render(createElement(OnboardingChecklist));
  const steps = screen.getAllByRole("listitem");
  expect(steps[1].textContent).toContain("Schedule your first post");
  expect(steps[2].textContent).toContain("3Install SimplePost in your AI");
  expect(screen.queryByText("Optional")).toBeNull();
  expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss getting started" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it("does not offer onboarding actions in an expired read-only workspace", () => {
  mockReadOnly = true;
  render(createElement(OnboardingChecklist));
  expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
});

it("finishes on scheduling without waiting for publication", () => {
  mockState = { hasConnectedAccount: true, hasAiConnection: true, hasPost: true, hasPublishedPost: false };
  render(createElement(OnboardingChecklist));
  expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
});

it.each([
  ["ChatGPT plugin", "https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795"],
  ["Claude connector", "https://claude.ai/directory/simplepost"],
])("opens %s directly and closes the dialog", (name, href) => {
  render(createElement(OnboardingChecklist));
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("link")).toHaveLength(2);
  expect(within(dialog).queryByRole("button", { name: "Install" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Claude Code" })).toBeNull();
  expect(within(dialog).queryByText(/claude mcp add|Start with a draft|Waiting for/)).toBeNull();
  const link = within(dialog).getByRole("link", { name: `${name} (opens in a new tab)` });
  expect(link.getAttribute("href")).toBe(href);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  fireEvent.click(link);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps commands under Others and preserves keyboard focus and selection when navigating back", () => {
  const onClose = jest.fn();
  render(createElement(AiConnectModal, { open: true, onClose }));
  fireEvent.click(screen.getByRole("button", { name: /^Others/ }));
  const back = screen.getByRole("button", { name: "All integrations" });
  expect(document.activeElement).toBe(back);
  const choices = screen.getByRole("group", { name: "Other integrations" });
  expect(within(choices).getAllByRole("button")).toHaveLength(4);
  expect(screen.queryByRole("link", { name: /ChatGPT plugin|Claude connector/ })).toBeNull();
  expect(screen.getByText(/claude mcp add/)).toBeTruthy();
  fireEvent.click(within(choices).getByRole("button", { name: "OpenClaw" }));
  expect(screen.getByText("openclaw mcp login simplepost")).toBeTruthy();
  fireEvent.click(within(choices).getByRole("button", { name: "MCP" }));
  expect(screen.getByText(/https:\/\/.*\/mcp/)).toBeTruthy();
  fireEvent.click(within(choices).getByRole("button", { name: "CLI" }));
  expect(screen.getByText("npm install -g @simple-post/cli")).toBeTruthy();
  expect(screen.getByText("simplepost setup --backend keychain")).toBeTruthy();
  fireEvent.click(back);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Others/ }));
  expect(screen.queryByText("npm install -g @simple-post/cli")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /^Others/ }));
  expect(screen.getByRole("button", { name: "CLI" }).getAttribute("aria-pressed")).toBe("true");
  expect(onClose).not.toHaveBeenCalled();
});

it("offers the same direct installation links outside the dialog", () => {
  render(createElement(AssistantSelector));
  expect(screen.getByRole("link", { name: "Claude connector (opens in a new tab)" }).getAttribute("href")).toBe(
    "https://claude.ai/directory/simplepost",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Others/ }));
  fireEvent.click(screen.getByRole("button", { name: "All integrations" }));
  expect(screen.getAllByRole("link")).toHaveLength(2);
});
