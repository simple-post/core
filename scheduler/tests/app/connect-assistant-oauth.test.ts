import { NextRequest, NextResponse } from "next/server";

import { GET as start } from "@/app/api/connect/[platform]/route";
import { GET as callback } from "@/app/api/connect/callback/[platform]/route";
import { createConnectionHandoff } from "@/lib/accounts/assistant-handoff";
import { recordFunnelEvent } from "@/lib/analytics/events";
import { requireAuth } from "@/lib/middleware/auth";
import { exchangeCodeForToken, handlePlatformCallback } from "@/lib/oauth";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_error" }));
jest.mock("@/lib/oauth", () => ({
  ...jest.requireActual("@/lib/oauth/state"),
  ...jest.requireActual("@/lib/oauth/errors"),
  getPlatformOAuthConfig: () => ({
    authUrl: "https://x.com/i/oauth2/authorize",
    clientId: "configured",
    scope: "tweet.write",
    responseType: "code",
    requiresPkce: true,
  }),
  generatePkce: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  setPkceCookie: jest.fn(),
  getPkceVerifier: () => "verifier",
  clearPkceCookie: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  exchangeCodeForBlueskyToken: jest.fn(),
  handlePlatformCallback: jest.fn(),
}));

const params = { params: Promise.resolve({ platform: "x" }) };
const callbackRequest = (state: string, suffix = "code=provider-code") =>
  new NextRequest(`https://simplepost.example/api/connect/callback/x?state=${encodeURIComponent(state)}&${suffix}`);
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: "user-1" } } as never);
  jest.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "private-provider-token" });
  jest
    .mocked(handlePlatformCallback)
    .mockImplementation(async () =>
      NextResponse.redirect("https://app.simplepost.social/accounts?success=true&platform=x"),
    );
});

it("starts provider consent directly with signed source and PKCE, without leaking the handoff token", async () => {
  const token = createConnectionHandoff("user-1", "x");
  const response = await start(
    new NextRequest(`https://simplepost.example/api/connect/x?handoffToken=${token}`),
    params,
  );
  const url = new URL(response.headers.get("location")!);
  expect(url.origin).toBe("https://x.com");
  expect(url.searchParams.get("code_challenge")).toBe("challenge");
  expect(verifyOAuthState(url.searchParams.get("state")!)).toMatchObject({
    userId: "user-1",
    platform: "x",
    source: "assistant_handoff",
  });
  expect(url.href).not.toContain(token);
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "user-1",
    "social_connection_started",
    expect.objectContaining({ properties: { platform: "x", source: "assistant_handoff" } }),
  );
});

it("rejects a different browser user even when bypassing the handoff preparation route", async () => {
  const token = createConnectionHandoff("other-user", "x");
  const response = await start(
    new NextRequest(`https://simplepost.example/api/connect/x?handoffToken=${token}`),
    params,
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("location")).toBeNull();
});

it("carries source to completion and the return-to-assistant confirmation", async () => {
  const state = createOAuthState("user-1", "x", "assistant_handoff");
  const response = await callback(callbackRequest(state), params);
  expect(new URL(response.headers.get("location")!).searchParams.get("source")).toBe("assistant_handoff");
  expect(handlePlatformCallback).toHaveBeenCalledWith(
    expect.objectContaining({ source: "assistant_handoff", userId: "user-1" }),
  );
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "user-1",
    "social_connection_completed",
    expect.objectContaining({ properties: { platform: "x", source: "assistant_handoff" } }),
  );
});

it("does not count a pending account picker or a provider error as completed", async () => {
  const state = createOAuthState("user-1", "x", "assistant_handoff");
  jest
    .mocked(handlePlatformCallback)
    .mockResolvedValueOnce(
      NextResponse.redirect("https://app.simplepost.social/accounts/connect/facebook?pendingId=pending-1"),
    );
  const response = await callback(callbackRequest(state), params);
  expect(response.headers.get("location")).toContain("source=assistant_handoff");
  expect(recordFunnelEvent).not.toHaveBeenCalledWith(
    expect.anything(),
    "social_connection_completed",
    expect.anything(),
  );
  jest.clearAllMocks();
  const denied = await callback(callbackRequest(state, "error=access_denied"), params);
  expect(denied.headers.get("location")).toContain("source=assistant_handoff");
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "user-1",
    "social_connection_cancelled",
    expect.objectContaining({
      properties: { platform: "x", reason: "authorization_denied", source: "assistant_handoff" },
    }),
  );
  expect(exchangeCodeForToken).not.toHaveBeenCalled();
});

it("keeps the existing callback user check before token exchange", async () => {
  const state = createOAuthState("other-user", "x", "assistant_handoff");
  const response = await callback(callbackRequest(state), params);
  expect(response.headers.get("location")).toContain("error=");
  expect(exchangeCodeForToken).not.toHaveBeenCalled();
  expect(handlePlatformCallback).not.toHaveBeenCalled();
});
