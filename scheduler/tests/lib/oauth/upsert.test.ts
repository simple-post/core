import { Prisma } from "@prisma/client";

import { assertCanConnectAccount, lockUserForQuota } from "@/lib/billing/subscriptions";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/billing/subscriptions", () => ({
  assertCanConnectAccount: jest.fn(),
  lockUserForQuota: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    socialActivitySync: { updateMany: jest.fn() },
    postAnalytics: { updateMany: jest.fn() },
    connectedAccount: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  connectedAccount: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => unknown) =>
    callback(prismaMock),
  );
  prismaMock.connectedAccount.findFirst.mockResolvedValue({ id: "acct-1" });
  prismaMock.connectedAccount.update.mockResolvedValue({});
  prismaMock.connectedAccount.updateMany.mockResolvedValue({ count: 1 });
});

describe("verified legacy YouTube identities", () => {
  const updatedAt = new Date("2026-10-01T00:00:00Z");
  const data = {
    userId: "user-1",
    platform: "youtube",
    platformAccountId: "UC-channel",
    previousIdentity: { platformAccountId: "1234567890", updatedAt },
    accessToken: "new-token",
    refreshToken: "new-refresh",
    expiresAt: null,
    scope: null,
    username: "channel",
    displayName: "Channel",
    email: null,
    profilePicture: null,
  };

  it("upgrades the same row before quota checks so scheduled posts and account slots are preserved", async () => {
    prismaMock.connectedAccount.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "legacy-row" })
      .mockResolvedValueOnce({ id: "legacy-row" });
    await upsertConnectedAccount(data);

    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: "legacy-row",
        userId: "user-1",
        workspaceId: null,
        platform: "youtube",
        platformAccountId: "1234567890",
        updatedAt,
      },
      data: { platformAccountId: "UC-channel" },
    });
    const updateOrder = prismaMock.connectedAccount.updateMany.mock.invocationCallOrder[0];
    expect((lockUserForQuota as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(updateOrder);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan((assertCanConnectAccount as jest.Mock).mock.invocationCallOrder[0]);
    expect(prismaMock.connectedAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-row" },
      }),
    );
  });

  it("reconnects an existing canonical channel without changing another legacy row", async () => {
    await upsertConnectedAccount(data);
    expect(prismaMock.connectedAccount.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.connectedAccount.update).toHaveBeenCalled();
  });

  it.each(["changed", "deleted"])("aborts when the verified legacy row was %s during authorization", async (state) => {
    prismaMock.connectedAccount.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(state === "deleted" ? null : { id: "legacy-row" });
    prismaMock.connectedAccount.updateMany.mockResolvedValue({ count: 0 });

    await expect(upsertConnectedAccount(data)).rejects.toMatchObject({ code: "profile_fetch_failed" });
    expect(prismaMock.connectedAccount.update).not.toHaveBeenCalled();
    expect(assertCanConnectAccount).not.toHaveBeenCalled();
  });
});

describe("upsertConnectedAccount", () => {
  it("serializes reconnects with refreshes and clears stale refresh failure state", async () => {
    await upsertConnectedAccount({
      accessToken: "new-access",
      displayName: "Test Account",
      email: null,
      expiresAt: new Date("2026-07-14T21:00:00.000Z"),
      platform: "instagram",
      platformAccountId: "instagram-user-1",
      profilePicture: null,
      refreshToken: null,
      scope: "instagram_business_basic",
      userId: "user-1",
      username: "tester",
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.connectedAccount.update.mock.invocationCallOrder[0],
    );
    expect(prismaMock.connectedAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credentialRefreshBlockedAt: null,
          credentialRefreshRetryAt: null,
          tokenMetadata: Prisma.DbNull,
        }),
      }),
    );
  });
});
