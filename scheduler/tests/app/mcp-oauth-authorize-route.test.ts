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
  process.env.MUSE_OAUTH_CLIENT_IDS = "muse-client";
  requireBrowserSessionMock.mockResolvedValue({ user: { id: "review-user" } } as never);
  assertActiveSubscriptionMock.mockResolvedValue({} as never);
  jest.mocked(ensureTrialStarted).mockResolvedValue(null);
  validateClientMock.mockImplementation(
    async (clientId) =>
      ({
        clientId,
        scope: "openid email accounts:read posts:read posts:validate posts:write",
      }) as never,
  );
  createAuthorizationCodeMock.mockResolvedValue("authorization-code");
  updateClientScopeMock.mockResolvedValue(undefined);
});

afterEach(() => delete process.env.MUSE_OAUTH_CLIENT_IDS);

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
    redirectUrl:
      "https://chatgpt.com/connector_platform_oauth_redirect?code=authorization-code&state=state-123&iss=http%3A%2F%2Flocalhost%3A3000",
  });
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({
      clientId: "chatgpt-client",
      nonce: undefined,
      userId: "review-user",
    }),
  );
});

const consentRequest = (overrides: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost:3000/api/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "muse-client",
      redirect_uri: "https://example.com/callback",
      state: "state",
      code_challenge: "challenge",
      scope: "openid email accounts:read posts:read posts:validate posts:write",
      ...overrides,
    }),
  });

it("persists read-only consent without granting writes", async () => {
  const response = await POST(consentRequest({ access_mode: "read_only" }));
  expect(response.status).toBe(200);
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({ scope: "openid email accounts:read posts:read", enforceRestScopes: true }),
  );
});

it("never broadens a limited request when choosing read-only", async () => {
  const response = await POST(consentRequest({ access_mode: "read_only", scope: "accounts:read" }));
  expect(response.status).toBe(200);
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(expect.objectContaining({ scope: "accounts:read" }));
});

it.each([
  { access_mode: "admin" },
  { access_mode: "read_only", scope: "posts:write" },
  { access_mode: "read_only", scope: "posts:validate" },
  { access_mode: "read_only", scope: "unknown posts:write" },
])("rejects invalid or empty consent grants: %j", async (overrides) => {
  const response = await POST(consentRequest(overrides));
  expect(response.status).toBe(400);
  expect(createAuthorizationCodeMock).not.toHaveBeenCalled();
});

it("still rejects scope escalation even when choosing read-only", async () => {
  validateClientMock.mockResolvedValue({ clientId: "muse-client", scope: "accounts:read" } as never);
  const response = await POST(consentRequest({ access_mode: "read_only", scope: "accounts:read posts:write" }));
  expect(response.status).toBe(400);
  expect(createAuthorizationCodeMock).not.toHaveBeenCalled();
});

it.each([undefined, "read_write"])("keeps read/write as the default for Muse (%s)", async (access_mode) => {
  const response = await POST(consentRequest({ access_mode }));
  expect(response.status).toBe(200);
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "openid email accounts:read posts:read posts:validate posts:write",
      enforceRestScopes: true,
    }),
  );
});

it.each([undefined, "read_only", "admin"])(
  "preserves other clients' original grants regardless of Muse-only fields (%s)",
  async (access_mode) => {
    validateClientMock.mockResolvedValue({
      clientId: "other-client",
      name: "Muse",
      scope: "openid email accounts:read posts:read posts:validate posts:write",
    } as never);
    const response = await POST(consentRequest({ client_id: "other-client", access_mode, enforceRestScopes: true }));
    expect(response.status).toBe(200);
    expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "openid email accounts:read posts:read posts:validate posts:write",
        enforceRestScopes: false,
      }),
    );
  },
);

it("does not enable Muse consent when the server allowlist is unset", async () => {
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
  const response = await POST(consentRequest({ access_mode: "read_only" }));
  expect(response.status).toBe(200);
  expect(createAuthorizationCodeMock).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "openid email accounts:read posts:read posts:validate posts:write",
      enforceRestScopes: false,
    }),
  );
});
