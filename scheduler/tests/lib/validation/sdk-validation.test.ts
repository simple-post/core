import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/config", () => ({
  getPlatformById: (platform: string) => ({ id: platform, name: "X (Twitter)" }),
  isSocialPlatformEnabled: () => true,
}));

const prismaMock = prisma as unknown as {
  connectedAccount: {
    findMany: jest.Mock;
  };
};

const connectedAccount = {
  id: "account-1",
  userId: "user-1",
  platform: "x",
  platformAccountId: "x-1",
  accessToken: "encrypted-access-token",
  refreshToken: "encrypted-refresh-token",
  tokenMetadata: { previewOnly: true },
  credentialRefreshRetryAt: null,
  credentialRefreshBlockedAt: null,
  tokenType: "Bearer",
  expiresAt: null,
  scope: null,
  username: "preview",
  displayName: "Preview Account",
  email: null,
  profilePicture: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("marks preview-only accounts as unpublishable and strips credentials from validation output", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([connectedAccount]);

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media: [],
    accountIds: ["account-1"],
  });

  expect(result.summary.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "preview_only_account", meta: { accountId: "account-1" } }),
    ]),
  );
  expect(result.accounts[0]).toMatchObject({
    id: "account-1",
    accessToken: "",
    refreshToken: null,
    previewOnly: true,
  });
});
