/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });

import { createElement } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LoginForm } from "@/components/login-form";

const mockSendOtp = jest.fn();
const mockSignIn = jest.fn();
const mockSocial = jest.fn();
jest.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    emailOtp: { sendVerificationOtp: (...args: unknown[]) => mockSendOtp(...args) },
    signIn: {
      emailOtp: (...args: unknown[]) => mockSignIn(...args),
      social: (...args: unknown[]) => mockSocial(...args),
    },
  },
}));
jest.mock("@/components/platform-icons", () => ({ PlatformIcon: () => null }));
jest.mock("@/lib/analytics/first-touch", () => ({ captureFirstTouch: jest.fn() }));
jest.mock("@/lib/analytics/plausible", () => ({ trackEvent: jest.fn() }));
jest.mock("@/lib/logger/client", () => ({ logClientError: jest.fn() }));

const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) });
  mockSendOtp.mockResolvedValue({ data: { success: true }, error: null });
  mockSignIn.mockResolvedValue({ error: { code: "INVALID_OTP", status: 400 } });
  mockSocial.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

async function start(email: string, callbackURL?: string) {
  render(createElement(LoginForm, { callbackURL }));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Continue with email" }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.queryByLabelText("Password")).toBeNull();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
  });
}

it("uses email codes for regular accounts even when demo login is enabled", async () => {
  await start("person@example.com");
  const field = await screen.findByLabelText("Verification code");
  expect(field.getAttribute("autocomplete")).toBe("one-time-code");
  expect(field.getAttribute("inputmode")).toBe("numeric");
  expect(mockSendOtp).toHaveBeenCalledWith({ email: "person@example.com", type: "sign-in" });
  expect(screen.queryByLabelText("Password")).toBeNull();
  fireEvent.change(field, { target: { value: "012345" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByText("Invalid or expired code. Try again or request a new code.");
  expect(mockSignIn).toHaveBeenCalledWith({ email: "person@example.com", otp: "012345" });
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  expect((screen.getByLabelText("Email address") as HTMLInputElement).readOnly).toBe(false);
});

it("shows only a masked password for the normalized demo address", async () => {
  await start("DEMO@simplepost.social");
  const field = await screen.findByLabelText("Password");
  expect(field.getAttribute("type")).toBe("password");
  expect(field.getAttribute("autocomplete")).toBe("current-password");
  expect(screen.queryByText("Verify code")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(/Resend code/)).toBeNull();
  fireEvent.change(field, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Invalid or expired password. Try again or start over.");
  expect(mockSignIn).toHaveBeenCalledWith({ email: "demo@simplepost.social", otp: "123456" });
});

it("uses ordinary OTP for the former OpenAI test address", async () => {
  await start("openai@simplepost.social");
  await screen.findByLabelText("Verification code");
  expect(screen.queryByLabelText("Password")).toBeNull();
});

it("uses ordinary OTP for demo when the server flag is disabled", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
  await start("demo@simplepost.social");
  await screen.findByLabelText("Verification code");
  expect(screen.queryByLabelText("Password")).toBeNull();
});

it("stays on the email step when sending fails", async () => {
  mockSendOtp.mockResolvedValue({ error: { status: 500 } });
  await start("person@example.com");
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("throttles resend and sends another code after the cooldown", async () => {
  await start("person@example.com");
  await screen.findByLabelText("Verification code");
  jest.useFakeTimers();
  // The first real timer schedules subsequent ticks using fake timers.
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with email" })));
  expect((screen.getByRole("button", { name: "Resend code in 30s" }) as HTMLButtonElement).disabled).toBe(true);
  for (let second = 0; second < 30; second++) await act(async () => jest.advanceTimersByTime(1000));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resend code" })));
  expect(mockSendOtp).toHaveBeenCalledTimes(3);
});

it("preserves the full OAuth continuation when starting Google sign-in", async () => {
  const callbackURL =
    "/oauth/authorize?scope=posts:write&state=a%2Bb&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback";
  render(createElement(LoginForm, { callbackURL }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() =>
    expect(mockSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: `http://localhost${callbackURL}` }),
  );
});
