/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AssistantSelector } from "@/components/assistant-selector";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { STARTER_PROMPTS } from "@/lib/distribution/starter-prompts";

let mockState = { hasConnectedAccount: false, hasAiConnection: false, hasPost: false };
let mockActive = true;
let mockDismissed = false;
let mockFetched = true;
const mockDismiss = jest.fn();
jest.mock("@/hooks/use-billing", () => ({
  useBillingStatus: () => ({
    data: {
      active: mockActive,
      accessType: "trial",
      trial: { startsAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-08T00:00:00Z" },
    },
  }),
}));
jest.mock("@/components/onboarding/use-onboarding", () => ({
  useOnboardingState: () => ({ data: mockState, isFetchedAfterMount: mockFetched }),
  useOnboardingDismissal: () => ({ dismissed: mockDismissed, ready: true, dismiss: mockDismiss }),
}));

beforeEach(() => {
  mockState = { hasConnectedAccount: false, hasAiConnection: false, hasPost: false };
  mockActive = true;
  mockDismissed = false;
  mockFetched = true;
  jest.clearAllMocks();
});
afterEach(cleanup);

it("welcomes the user with their trial and guides them through the three steps", () => {
  render(createElement(OnboardingModal));
  const dialog = screen.getByRole("dialog", { name: "Welcome to SimplePost" });
  expect(within(dialog).getByText("Your 7-day free trial has started.")).toBeTruthy();
  expect(
    within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Connect a social account", "Connect your AI assistant", "Write your first post"]);
  expect(within(dialog).getByRole("link", { name: "Connect an account" }).getAttribute("href")).toBe(
    "/accounts?onboarding=connect",
  );
  expect(within(dialog).queryByRole("button", { name: "Choose an assistant" })).toBeNull();
});

it("marks the assistant step complete for a connector-first signup", () => {
  mockState.hasAiConnection = true;
  render(createElement(OnboardingModal));
  const steps = screen.getAllByRole("listitem");
  expect(within(steps[1]).getByLabelText("Complete")).toBeTruthy();
  expect(within(steps[0]).getByRole("link", { name: "Connect an account" })).toBeTruthy();
});

it("offers manual writing after connecting a social account", () => {
  mockState.hasConnectedAccount = true;
  render(createElement(OnboardingModal));
  expect(screen.getByRole("link", { name: "Write manually" }).getAttribute("href")).toBe("/schedule");
});

it("advances to the starter prompt once it observes an assistant connection", async () => {
  mockState.hasConnectedAccount = true;
  const { rerender } = render(createElement(OnboardingModal));
  fireEvent.click(screen.getByRole("button", { name: "Choose an assistant" }));

  mockState.hasAiConnection = true;
  rerender(createElement(OnboardingModal));

  expect(screen.getByRole("dialog", { name: "Welcome to SimplePost" })).toBeTruthy();
  expect(screen.getByText(STARTER_PROMPTS[0].prompt)).toBeTruthy();
  const writeText = jest.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  try {
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith(STARTER_PROMPTS[0].prompt);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied to clipboard" })).toBeTruthy());
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("closes when a post is detected even if AI setup was skipped", () => {
  const { rerender } = render(createElement(OnboardingModal));
  expect(screen.getByRole("dialog")).toBeTruthy();
  mockState.hasPost = true;
  rerender(createElement(OnboardingModal));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it("lets the user skip setup and respects dismissal", () => {
  const { rerender } = render(createElement(OnboardingModal));
  fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  mockDismissed = true;
  rerender(createElement(OnboardingModal));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("waits for current progress and stays hidden in an expired workspace", () => {
  mockFetched = false;
  const { rerender } = render(createElement(OnboardingModal));
  expect(screen.queryByRole("dialog")).toBeNull();
  mockFetched = true;
  mockActive = false;
  rerender(createElement(OnboardingModal));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([
  ["ChatGPT plugin", "https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795"],
  ["Claude connector", "https://claude.ai/directory/simplepost"],
])("opens %s in another tab and returns to the setup steps", (name, href) => {
  mockState.hasConnectedAccount = true;
  render(createElement(OnboardingModal));
  fireEvent.click(screen.getByRole("button", { name: "Choose an assistant" }));
  const dialog = screen.getByRole("dialog", { name: "Connect your AI assistant" });
  const link = within(dialog).getByRole("link", { name: `${name} (opens in a new tab)` });
  expect(link.getAttribute("href")).toBe(href);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  fireEvent.click(link);
  expect(screen.getByRole("dialog", { name: "Welcome to SimplePost" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Checking for your assistant connection…");
});

it("keeps commands under Others and preserves keyboard focus and selection when navigating back", () => {
  const onInstall = jest.fn();
  render(createElement(AssistantSelector, { onInstall }));
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
  expect(onInstall).not.toHaveBeenCalled();
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

it.each([
  ["ChatGPT plugin", "ChatGPT", "https://chatgpt.com/plugins"],
  ["Claude connector", "Claude", "https://claude.ai/"],
])("offers custom %s setup at the current deployment", (label, assistant, setupUrl) => {
  const onInstall = jest.fn();
  render(createElement(AssistantSelector, { appUrl: "https://preview.example.test/", onInstall }));
  expect(screen.queryByRole("link", { name: /chatgpt plugin|claude connector/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(screen.getByText("https://preview.example.test/mcp")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All integrations" }));
  const trigger = screen.getByRole("button", { name: label });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  const link = screen.getByRole("link", { name: `Open ${assistant} (opens in a new tab)` });
  expect(link.getAttribute("href")).toBe(setupUrl);
  fireEvent.click(link);
  expect(onInstall).toHaveBeenCalledTimes(1);
});
