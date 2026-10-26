/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AiConnectModal } from "@/components/onboarding/ai-connect-modal";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";

let mockState = {
  hasConnectedAccount: false,
  hasAiConnection: false,
  hasPost: false,
  hasPublishedPost: false,
};
const mockDismiss = jest.fn();
jest.mock("@/components/onboarding/use-onboarding", () => ({
  useOnboardingState: () => ({ data: mockState }),
  useOnboardingDismissal: () => ({ dismissed: false, ready: true, dismiss: mockDismiss }),
}));

beforeEach(() => {
  mockState = { hasConnectedAccount: false, hasAiConnection: false, hasPost: false, hasPublishedPost: false };
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

it("finishes on scheduling without waiting for publication", () => {
  mockState = { hasConnectedAccount: true, hasAiConnection: true, hasPost: true, hasPublishedPost: false };
  render(createElement(OnboardingChecklist));
  expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
});

it("opens installation only on request and closes when ChatGPT installation launches", () => {
  render(createElement(OnboardingChecklist));
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "ChatGPT" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Claude Code" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "OpenClaw" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Others" })).toBeTruthy();
  expect(within(dialog).queryByText(/Start with a draft|Product update|Waiting for/)).toBeNull();
  const install = within(dialog).getByRole("link", { name: /Install SimplePost in ChatGPT/ });
  expect(install.getAttribute("href")).toMatch(/^https:\/\/chatgpt.com\/plugins\//);
  expect(install.getAttribute("target")).toBe("_blank");
  fireEvent.click(install);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps technical setup under Others and preserves each setup path", () => {
  render(createElement(AiConnectModal, { open: true, onClose: jest.fn() }));
  expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
  expect(screen.getByText(/claude mcp add/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "OpenClaw" }));
  expect(screen.getByText("openclaw mcp login simplepost")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Others" }));
  expect(screen.getByRole("link", { name: /Connect SimplePost in Claude/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "MCP" }));
  expect(screen.getByText(/https:\/\/.*\/mcp/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "CLI" }));
  expect(screen.getByText("npm install -g @simple-post/cli")).toBeTruthy();
  expect(screen.getByText("simplepost setup --backend keychain")).toBeTruthy();
});
