import { NextRequest } from "next/server";

import { POST } from "@/app/api/oauth/authorize/route";
import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { ensureTrialStarted } from "@/lib/billing/trial";
import { createAuthorizationCode, updateClientScope, validateClient } from "@/lib/mcp/oauth";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { PaymentRequiredError } from "@/lib/utils/errors";

jest.mock("@/lib/billing/subscriptions", () => ({ assertActiveSubscription: jest.fn() }));
jest.mock("@/lib/billing/trial", () => ({ ensureTrialStarted: jest.fn() }));
jest.mock("@/lib/mcp/oauth", () => ({
  createAuthorizationCode: jest.fn(),
  updateClientScope: jest.fn(),
  validateClient: jest.fn(),
}));
jest.mock("@/lib/middleware/auth", () => ({ requireBrowserSession: jest.fn() }));

const requireBrowserSessionMock = requireBrowserSession as jest.MockedFunction<typeof requireBrowserSession>;
const ensureTrialStartedMock = ensureTrialStarted as jest.MockedFunction<typeof ensureTrialStarted>;
const assertActiveSubscriptionMock = assertActiveSubscription as jest.MockedFunction<typeof assertActiveSubscription>;
const validateClientMock = validateClient as jest.MockedFunction<typeof validateClient>;
const createAuthorizationCodeMock = createAuthorizationCode as jest.MockedFunction<typeof createAuthorizationCode>;
const updateClientScopeMock = updateClientScope as jest.MockedFunction<typeof updateClientScope>;

const redirectUri = "https://client.example/oauth/callback";

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("https://simplepost.example/api/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "client-1",
      redirect_uri: redirectUri,
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
      scope: "accounts:read posts:read posts:validate posts:write",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireBrowserSessionMock.mockResolvedValue({ user: { id: "user-1" } } as Awaited<
    ReturnType<typeof requireBrowserSession>
  >);
  validateClientMock.mockResolvedValue({
    clientId: "client-1",
    redirectUris: [redirectUri],
    scope: "accounts:read posts:read posts:validate posts:write",
  } as Awaited<ReturnType<typeof validateClient>>);
  createAuthorizationCodeMock.mockResolvedValue("authorization-code");
});

it("starts an eligible connector-first trial before enforcing billing", async () => {
  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(ensureTrialStartedMock).toHaveBeenCalledWith("user-1");
  expect(assertActiveSubscriptionMock).toHaveBeenCalledWith("user-1", { action: "oauth_authorize" });
  expect(ensureTrialStartedMock.mock.invocationCallOrder[0]).toBeLessThan(
    assertActiveSubscriptionMock.mock.invocationCallOrder[0],
  );
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: "client-1", userId: "user-1", redirectUri }),
  );
  await expect(response.json()).resolves.toEqual({
    redirectUrl: `${redirectUri}?code=authorization-code&state=state-1`,
  });
});

it("does not initialize a trial for an invalid OAuth client", async () => {
  validateClientMock.mockResolvedValue(null);

  const response = await POST(request());

  expect(response.status).toBe(400);
  expect(ensureTrialStartedMock).not.toHaveBeenCalled();
  expect(assertActiveSubscriptionMock).not.toHaveBeenCalled();
  expect(createAuthorizationCodeMock).not.toHaveBeenCalled();
});

it("does not create or mutate authorization state when billing remains inactive", async () => {
  assertActiveSubscriptionMock.mockRejectedValue(new PaymentRequiredError("subscription required"));

  const response = await POST(request());

  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({ error: "subscription required", code: "PAYMENT_REQUIRED" });
  expect(ensureTrialStartedMock).toHaveBeenCalledWith("user-1");
  expect(createAuthorizationCodeMock).not.toHaveBeenCalled();
  expect(updateClientScopeMock).not.toHaveBeenCalled();
});
