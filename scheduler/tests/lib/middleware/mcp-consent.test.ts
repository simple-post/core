import { NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { authenticateMcpToken } from "@/lib/mcp/oauth";
import { getSession, requireAuth } from "@/lib/middleware/auth";

jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/mcp/oauth", () => ({ isMcpToken: () => true, authenticateMcpToken: jest.fn() }));
jest.mock("@/lib/billing/subscriptions", () => ({ assertActiveSubscription: jest.fn(), assertPlanFeature: jest.fn() }));
jest.mock("@/lib/logger/request-context", () => ({ rememberRequestUser: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authenticateMcpToken).mockResolvedValue({
    user: { id: "review" },
    session: { scope: "accounts:read posts:read", enforceRestScopes: true },
  } as never);
  jest.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "browser-user" } } as never);
});

it.each([requireAuth, getSession])(
  "does not let a restricted bearer fall back to browser permissions",
  async (authenticate) => {
    const req = new NextRequest("http://localhost:3000/api/v1/posts", {
      method: "POST",
      headers: { authorization: "Bearer sp_mcp_review", cookie: "session=broader-browser" },
    });
    await expect(authenticate(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(auth.api.getSession).not.toHaveBeenCalled();
  },
);

it("still authenticates an allowed read without changing the browser/API/CLI paths", async () => {
  const req = new NextRequest("http://localhost:3000/api/v1/accounts", {
    headers: { authorization: "Bearer sp_mcp_review" },
  });
  await expect(requireAuth(req)).resolves.toMatchObject({ user: { id: "review" } });
  expect(auth.api.getSession).not.toHaveBeenCalled();
});

it.each([false, undefined])("preserves existing non-Muse REST access (%s)", async (enforceRestScopes) => {
  jest.mocked(authenticateMcpToken).mockResolvedValue({
    user: { id: "existing-client" },
    session: { scope: "accounts:read", enforceRestScopes },
  } as never);
  const req = new NextRequest("http://localhost:3000/api/v1/posts", {
    method: "POST",
    headers: { authorization: "Bearer sp_mcp_existing" },
  });
  await expect(requireAuth(req)).resolves.toMatchObject({ user: { id: "existing-client" } });
  expect(auth.api.getSession).not.toHaveBeenCalled();
});

it("keeps Muse enforcement after its client is removed from the deployment allowlist", async () => {
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
  const req = new NextRequest("http://localhost:3000/api/v1/posts", {
    method: "POST",
    headers: { authorization: "Bearer sp_mcp_review" },
  });
  await expect(requireAuth(req)).rejects.toMatchObject({ statusCode: 403 });
});
