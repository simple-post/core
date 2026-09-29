import { handleLinkedInCallback } from "@/lib/oauth/callbacks/linkedin";
import { fetchLinkedInPages, fetchLinkedInMemberProfile } from "@/lib/oauth/linkedin-pages";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/logger", () => ({ authLogger: { warn: jest.fn() } }));
jest.mock("@/lib/oauth/config", () => ({
  getPlatformOAuthConfig: () => ({
    scope: "openid profile email w_member_social w_organization_social rw_organization_admin",
  }),
}));
jest.mock("@/lib/oauth/linkedin-pages", () => ({
  fetchLinkedInPages: jest.fn(),
  fetchLinkedInMemberProfile: jest.fn(),
}));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  encryptConnectedAccountSecrets: (value: Record<string, unknown>) => ({
    ...value,
    accessToken: "encrypted-access",
    refreshToken: "encrypted-refresh",
  }),
}));
jest.mock("@/lib/prisma", () => ({ prisma: { pendingOAuthConnection: { deleteMany: jest.fn(), create: jest.fn() } } }));

const ctx = {
  userId: "u1",
  platform: "linkedin",
  baseURL: "https://simplepost.example",
  accessToken: "access",
  refreshToken: "refresh",
  tokenData: {},
  expiresIn: 3600,
  scope: "w_member_social w_organization_social rw_organization_admin",
  tokenMetadata: { refreshTokenExpiresAt: "2030-01-01" },
};
const create = prisma.pendingOAuthConnection.create as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  create.mockResolvedValue({ id: "pending" });
  (fetchLinkedInMemberProfile as jest.Mock).mockResolvedValue({
    sub: "member1",
    name: "Member",
    email: "member@example.com",
    picture: "https://media.licdn.com/member.jpg",
  });
  (fetchLinkedInPages as jest.Mock).mockResolvedValue([
    { id: "urn:li:organization:123", name: "Company", username: "company", profilePicture: null },
  ]);
});

it("offers the unchanged member identity alongside a Page with encrypted credentials and expiry", async () => {
  const before = Date.now();
  const result = await handleLinkedInCallback(ctx);
  expect(result.headers.get("location")).toBe("https://simplepost.example/accounts/connect/linkedin?pendingId=pending");
  const data = create.mock.calls[0][0].data.data;
  expect(data.accounts.map((account: { id: string }) => account.id)).toEqual(["member1", "urn:li:organization:123"]);
  for (const account of data.accounts) {
    expect(account).toMatchObject({
      accessToken: "encrypted-access",
      refreshToken: "encrypted-refresh",
      tokenMetadata: { linkedinMemberId: "member1", refreshTokenExpiresAt: "2030-01-01" },
    });
    expect(new Date(account.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
  }
});

it.each(["empty", "denied"])(
  "keeps the profile selectable with an actionable warning when Page discovery is %s",
  async (kind) => {
    if (kind === "empty") (fetchLinkedInPages as jest.Mock).mockResolvedValue([]);
    else (fetchLinkedInPages as jest.Mock).mockRejectedValue(new Error("Reconnect and grant Page access"));
    await handleLinkedInCallback(ctx);
    const data = create.mock.calls[0][0].data.data;
    expect(data.accounts).toHaveLength(1);
    expect(data.warning).toMatch(/Page/);
  },
);

it("does not query Pages with a token missing organization posting permission", async () => {
  await handleLinkedInCallback({ ...ctx, scope: "w_member_social" });
  expect(fetchLinkedInPages).not.toHaveBeenCalled();
  expect(create.mock.calls[0][0].data.data.warning).toContain("permission was not granted");
});

it("does not save accounts without the authenticating member ID", async () => {
  (fetchLinkedInMemberProfile as jest.Mock).mockResolvedValue({});
  await expect(handleLinkedInCallback(ctx)).rejects.toThrow("member ID");
  expect(create).not.toHaveBeenCalled();
});
