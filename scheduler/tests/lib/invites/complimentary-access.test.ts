import { calculateComplimentaryAccessEnd, redeemComplimentaryInvite } from "@/lib/invites/complimentary-access";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

const tx = {
  complimentaryAccessInvite: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  complimentaryAccess: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockTransaction = prisma.$transaction as jest.Mock;

describe("complimentary access invites", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  });

  it("calculates access duration from the redemption time", () => {
    expect(calculateComplimentaryAccessEnd(now, 90).toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });

  it("atomically claims an invite and creates the configured grant", async () => {
    tx.complimentaryAccessInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "secret-code",
      planKey: "pro",
      accessDurationDays: 90,
      expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      redeemedAt: null,
      redeemedByUserId: null,
    });
    tx.user.findUnique.mockResolvedValue({ subscription: null, complimentaryAccess: null });
    tx.complimentaryAccessInvite.updateMany.mockResolvedValue({ count: 1 });
    tx.complimentaryAccess.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create);

    const result = await redeemComplimentaryInvite("user-1", " secret-code ", now);

    expect(tx.complimentaryAccessInvite.updateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", redeemedAt: null },
      data: { redeemedAt: now, redeemedByUserId: "user-1" },
    });
    expect(tx.complimentaryAccess.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: expect.objectContaining({
        userId: "user-1",
        planKey: "pro",
        startsAt: now,
        expiresAt: new Date("2026-10-11T12:00:00.000Z"),
        source: "invite",
        inviteId: "invite-1",
      }),
      update: expect.objectContaining({
        planKey: "pro",
        startsAt: now,
        source: "invite",
        inviteId: "invite-1",
      }),
    });
    expect(result).toMatchObject({ planKey: "pro", alreadyRedeemed: false });
  });

  it("rejects an invite already used by another user", async () => {
    tx.complimentaryAccessInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "used-code",
      planKey: "pro",
      accessDurationDays: 30,
      expiresAt: null,
      redeemedAt: new Date("2026-07-12T00:00:00.000Z"),
      redeemedByUserId: "user-2",
    });

    await expect(redeemComplimentaryInvite("user-1", "used-code", now)).rejects.toThrow("already been used");
    expect(tx.complimentaryAccessInvite.updateMany).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict during concurrent redemption", async () => {
    mockTransaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.complimentaryAccessInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "retry-code",
      planKey: "basic",
      accessDurationDays: 7,
      expiresAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    tx.user.findUnique.mockResolvedValue({ subscription: null, complimentaryAccess: null });
    tx.complimentaryAccessInvite.updateMany.mockResolvedValue({ count: 1 });
    tx.complimentaryAccess.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create);

    await expect(redeemComplimentaryInvite("user-1", "retry-code", now)).resolves.toMatchObject({
      planKey: "basic",
    });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not consume an invite when the user already has active access", async () => {
    tx.complimentaryAccessInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "new-code",
      planKey: "advanced",
      accessDurationDays: 30,
      expiresAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    tx.user.findUnique.mockResolvedValue({
      subscription: null,
      complimentaryAccess: { expiresAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    await expect(redeemComplimentaryInvite("user-1", "new-code", now)).rejects.toThrow(
      "already has active complimentary access",
    );
    expect(tx.complimentaryAccessInvite.updateMany).not.toHaveBeenCalled();
  });
});
