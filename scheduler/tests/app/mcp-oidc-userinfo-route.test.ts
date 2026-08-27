import { NextRequest } from "next/server";

import { GET } from "@/app/api/oauth/userinfo/route";
import { authenticateMcpToken } from "@/lib/mcp/oauth";

jest.mock("@/lib/mcp/oauth", () => ({
  authenticateMcpToken: jest.fn(),
}));

const authenticateMcpTokenMock = jest.mocked(authenticateMcpToken);

afterEach(() => {
  jest.clearAllMocks();
});

it("returns the verified email for a correctly scoped access token", async () => {
  authenticateMcpTokenMock.mockResolvedValue({
    user: {
      id: "user_123",
      name: "OpenAI Reviewer",
      email: "demo@simplepost.social",
      emailVerified: true,
      image: null,
    },
    session: {
      id: "token_123",
      token: "mcp",
      scope: "openid email accounts:read",
      scopes: ["accounts:read"],
      resource: "https://app.simplepost.social/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const response = await GET(
    new NextRequest("https://app.simplepost.social/api/oauth/userinfo", {
      headers: { authorization: "Bearer sp_mcp_test" },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    sub: "user_123",
    email: "demo@simplepost.social",
    email_verified: true,
    name: "OpenAI Reviewer",
  });
});

it("rejects a token that was issued without the OIDC scopes", async () => {
  authenticateMcpTokenMock.mockResolvedValue({
    user: {
      id: "user_123",
      name: "OpenAI Reviewer",
      email: "demo@simplepost.social",
      emailVerified: true,
      image: null,
    },
    session: {
      id: "token_123",
      token: "mcp",
      scope: "accounts:read",
      scopes: ["accounts:read"],
      resource: "https://app.simplepost.social/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const response = await GET(
    new NextRequest("https://app.simplepost.social/api/oauth/userinfo", {
      headers: { authorization: "Bearer sp_mcp_test" },
    }),
  );

  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
});
