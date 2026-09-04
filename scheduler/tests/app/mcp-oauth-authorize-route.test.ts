import { NextRequest } from "next/server";

import { POST } from "@/app/api/oauth/authorize/route";
import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { ensureTrialStarted } from "@/lib/billing/trial";
import { createAuthorizationCode, updateClientScope, validateClient } from "@/lib/mcp/oauth";
import { requireBrowserSession } from "@/lib/middleware/auth";

jest.mock("@/lib/billing/trial", () => ({ ensureTrialStarted: jest.fn().mockResolvedValue(undefined) }));

jest.mock("@/lib/billing/subscriptions", () => ({
  assertActiveSubscription: jest.fn(),
}));

jest.mock("@/lib/billing/trial", () => ({ ensureTrialStarted: jest.fn() }));

jest.mock("@/lib/mcp/oauth", () => ({
  createAuthorizationCode: jest.fn(),
  updateClientScope: jest.fn(),
  validateClient: jest.fn(),
}));

jest.mock("@/lib/middleware/auth", () => ({
  requireBrowserSession: jest.fn(),
}));

const assertActiveSubscriptionMock = jest.mocked(assertActiveSubscription);
const createAuthorizationCodeMock = jest.mocked(createAuthorizationCode);
const updateClientScopeMock = jest.mocked(updateClientScope);
const validateClientMock = jest.mocked(validateClient);
const requireBrowserSessionMock = jest.mocked(requireBrowserSession);

beforeEach(() => {
  jest.clearAllMocks();
  requireBrowserSessionMock.mockResolvedValue({ user: { id: "review-user" } } as never);
  assertActiveSubscriptionMock.mockResolvedValue({} as never);
  jest.mocked(ensureTrialStarted).mockResolvedValue(null);
  validateClientMock.mockResolvedValue({
    clientId: "chatgpt-client",
    scope: "openid email accounts:read posts:read posts:validate posts:write",
  } as never);
  createAuthorizationCodeMock.mockResolvedValue("authorization-code");
  updateClientScopeMock.mockResolvedValue(undefined);
});

it("treats a null OIDC nonce as absent", async () => {
  const response = await POST(
    new NextRequest("http://localhost:3000/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "chatgpt-client",
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        state: "state-123",
        code_challenge: "challenge-123",
        code_challenge_method: "S256",
        scope: "openid email accounts:read posts:read posts:validate posts:write",
        nonce: null,
      }),
    }),
  );

  expect(response.status).toBe(200);
  expect(ensureTrialStarted).toHaveBeenCalledWith("review-user");
  await expect(response.json()).resolves.toEqual({
    redirectUrl: "https://chatgpt.com/connector_platform_oauth_redirect?code=authorization-code&state=state-123",
  });
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({
      clientId: "chatgpt-client",
      nonce: undefined,
      userId: "review-user",
    }),
  );
});
