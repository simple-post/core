import { createAuthorizationCode, exchangeCodeForToken, authenticateMcpToken, hashValue } from "@/lib/mcp/oauth";
import { isPersonalMuseClient } from "@/lib/mcp/personal-muse";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    mcpAuthorizationCode: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    mcpAccessToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock("@/lib/mcp/oidc", () => ({ createOidcIdToken: jest.fn() }));

beforeEach(() => jest.clearAllMocks());
afterEach(() => delete process.env.MUSE_OAUTH_CLIENT_IDS);

it("matches only exact configured IDs, with whitespace and multiple IDs supported", () => {
  process.env.MUSE_OAUTH_CLIENT_IDS = " muse-client , muse-review-client ";
  expect(isPersonalMuseClient("muse-client")).toBe(true);
  expect(isPersonalMuseClient("muse-review-client")).toBe(true);
  expect(isPersonalMuseClient("Muse")).toBe(false);
  expect(isPersonalMuseClient("muse-client-attacker")).toBe(false);
  expect(isPersonalMuseClient(undefined)).toBe(false);
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
  expect(isPersonalMuseClient("muse-client")).toBe(false);
});

it.each([true, false, undefined])(
  "stores the opt-in policy with the authorization code (%s)",
  async (enforceRestScopes) => {
    await createAuthorizationCode({
      clientId: "client",
      userId: "user",
      redirectUri: "https://example.com/callback",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      enforceRestScopes,
    });
    expect(prisma.mcpAuthorizationCode.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enforceRestScopes: enforceRestScopes ?? false }) }),
    );
  },
);

it.each([true, false])("preserves the code's REST policy during token exchange (%s)", async (enforceRestScopes) => {
  // Enforcement follows stored consent, not a subsequently changed allowlist.
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
  jest.mocked(prisma.mcpAuthorizationCode.findUnique).mockResolvedValue({
    id: "code",
    clientId: "client",
    userId: "user",
    redirectUri: "https://example.com/callback",
    expiresAt: new Date(Date.now() + 60_000),
    scope: "accounts:read posts:read",
    codeChallenge: Buffer.from(hashValue("verifier"), "hex").toString("base64url"),
    enforceRestScopes,
  } as never);
  const result = await exchangeCodeForToken({
    code: "raw-code",
    clientId: "client",
    redirectUri: "https://example.com/callback",
    codeVerifier: "verifier",
  });
  expect(result.ok).toBe(true);
  expect(prisma.mcpAccessToken.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ enforceRestScopes }) }),
  );
});

it.each([true, false])("returns the persisted policy when authenticating a token (%s)", async (enforceRestScopes) => {
  jest.mocked(prisma.mcpAccessToken.findUnique).mockResolvedValue({
    id: "token",
    clientId: "client",
    scope: "accounts:read posts:read",
    enforceRestScopes,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "user" },
  } as never);
  expect(await authenticateMcpToken("sp_mcp_test")).toMatchObject({ session: { enforceRestScopes } });
});
