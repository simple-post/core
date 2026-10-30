import { createConnectionHandoff, verifyConnectionHandoff } from "@/lib/accounts/assistant-handoff";
import { getAccountConnectionLinks } from "@/lib/mcp/connect-guidance";

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-10-30T12:00:00Z")));
afterEach(() => jest.useRealTimers());

it("binds links to both the requesting user and selected platform without exposing their identity", () => {
  const token = createConnectionHandoff("private-user-123", "x");
  expect(token).not.toContain("private-user-123");
  expect(() => verifyConnectionHandoff(token, "private-user-123", "x")).not.toThrow();
  expect(() => verifyConnectionHandoff(token, "other-user", "x")).toThrow("Sign in with the SimplePost account");
  expect(() => verifyConnectionHandoff(token, "private-user-123", "linkedin")).toThrow();
  expect(() => verifyConnectionHandoff(`${token.slice(0, -1)}!`, "private-user-123", "x")).toThrow();
});

it("expires after one hour and rejects missing or malformed tokens", () => {
  const token = createConnectionHandoff("user", "x");
  jest.advanceTimersByTime(60 * 60 * 1000);
  expect(() => verifyConnectionHandoff(token, "user", "x")).toThrow("expired");
  for (const value of [null, undefined, "", "123.bad", {}, "a".repeat(10_000)])
    expect(() => verifyConnectionHandoff(value, "user", "x")).toThrow();
});

it("returns a browser entry and connection type for every enabled platform", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://simplepost.example";
  const links = getAccountConnectionLinks("user");
  expect(links.find((link) => link.platform === "x")?.connectionType).toBe("oauth");
  expect(links.find((link) => link.platform === "forem")?.connectionType).toBe("manual");
  for (const link of links) {
    const url = new URL(link.url);
    expect(url.origin).toBe("https://simplepost.example");
    expect(url.pathname).toBe("/accounts");
    expect(url.searchParams.get("platform")).toBe(link.platform);
    verifyConnectionHandoff(url.searchParams.get("handoffToken"), "user", link.platform);
  }
});
