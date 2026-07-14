import { Prisma } from "@prisma/client";

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
    connectedAccount: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  connectedAccount: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => unknown) =>
    callback(prismaMock),
  );
  prismaMock.connectedAccount.findUnique.mockResolvedValue({ id: "acct-1" });
  prismaMock.connectedAccount.upsert.mockResolvedValue({});
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
      prismaMock.connectedAccount.upsert.mock.invocationCallOrder[0],
    );
    expect(prismaMock.connectedAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          credentialRefreshBlockedAt: null,
          credentialRefreshRetryAt: null,
          tokenMetadata: Prisma.DbNull,
        }),
      }),
    );
  });
});
