/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProtectedLayout from "@/app/(protected)/layout";
import { AuthorizePage } from "@/components/authorize-page";

let mockSession = { data: null, isPending: true };
const mockSendOtp = jest.fn();
const mockParams = new URLSearchParams("client_id=test&state=test");
jest.mock("@/lib/auth/auth-client", () => ({
  useSession: () => mockSession,
  authClient: { emailOtp: { sendVerificationOtp: (...args: unknown[]) => mockSendOtp(...args) } },
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/schedule", useSearchParams: () => mockParams }));
jest.mock("@/components/activation-analytics", () => ({ ActivationAnalytics: () => null }));
jest.mock("@/components/billing/subscription-gate", () => ({ SubscriptionGate: () => null }));
jest.mock("@/components/create-post-webmcp", () => ({ WebMcpProvider: () => null }));
jest.mock("@/components/onboarding/welcome-modal", () => ({ WelcomeModal: () => null }));
jest.mock("@/components/schedule-calendar-context", () => ({ ScheduleCalendarProvider: () => null }));
jest.mock("@/components/platform-icons", () => ({ PlatformIcon: () => null }));
jest.mock("@/lib/analytics/first-touch", () => ({ captureFirstTouch: jest.fn() }));
jest.mock("@/lib/analytics/plausible", () => ({ trackEvent: jest.fn() }));
jest.mock("@/lib/logger/client", () => ({ logClientError: jest.fn() }));

const originalFetch = global.fetch;
beforeEach(() => {
  mockSession = { data: null, isPending: true };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
  mockSendOtp.mockReset().mockResolvedValue({ data: { success: true }, error: null });
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const pages = {
  scheduler: () => createElement(ProtectedLayout, { children: "Private content" }),
  authorization: () =>
    createElement(AuthorizePage, {
      config: {
        title: "Connect SimplePost",
        description: "Connect",
        invalidMessage: "Invalid request",
        successMessage: "Connected",
        loginCallbackPath: "/oauth/authorize",
        validateParams: () => true,
        authorize: jest.fn(),
        buildCancelUrl: () => "/",
      },
    }),
};

it.each(Object.entries(pages))(
  "keeps %s code entry mounted while the session refreshes on tab focus",
  async (_name, page) => {
    const view = render(page());
    expect(screen.queryByLabelText("Email address")).toBeNull();
    mockSession = { data: null, isPending: false };
    view.rerender(page());
    const continueButton = await screen.findByRole("button", { name: "Continue with email" });
    await waitFor(() => expect((continueButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.com" } });
    await act(async () => fireEvent.click(continueButton));
    const codeField = await screen.findByLabelText("Verification code");
    fireEvent.change(codeField, { target: { value: "012" } });

    mockSession = { data: null, isPending: true };
    view.rerender(page());
    expect(screen.getByLabelText("Verification code")).toBe(codeField);
    expect((codeField as HTMLInputElement).value).toBe("012");
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("person@example.com");
    expect(codeField.getAttribute("placeholder")).toBe("Enter code");

    mockSession = { data: null, isPending: false };
    view.rerender(page());
    expect(screen.getByLabelText("Verification code")).toBe(codeField);
    expect((codeField as HTMLInputElement).value).toBe("012");
    expect(mockSendOtp).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  },
);
