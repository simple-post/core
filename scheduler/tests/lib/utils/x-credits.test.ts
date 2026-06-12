import { prisma } from "@/lib/prisma";
import {
  checkAndDeductXCredits,
  getXCredits,
  refundXCredits,
  refundXCreditsForDiscardedPost,
  refundXCreditsForFailedResults,
} from "@/lib/utils/x-credits";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: { count: jest.fn() },
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  connectedAccount: { count: jest.Mock };
  user: { findUniqueOrThrow: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({});
});

describe("getXCredits", () => {
  it("returns the user's credit balance", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ xPostingCredits: 7 });

    await expect(getXCredits("u1")).resolves.toBe(7);
  });
});

describe("checkAndDeductXCredits", () => {
  it("does nothing when no X accounts are targeted", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(0);

    await checkAndDeductXCredits("u1", ["telegram-account"]);

    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("deducts one credit per targeted X account with an atomic conditional update", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(2);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    await checkAndDeductXCredits("u1", ["x1", "x2"]);

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", xPostingCredits: { gte: 2 } },
      data: { xPostingCredits: { decrement: 2 } },
    });
  });

  it("rejects when the balance is insufficient (conditional update matched no row)", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(2);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ xPostingCredits: 1 });

    await expect(checkAndDeductXCredits("u1", ["x1", "x2"])).rejects.toThrow(/X posting credit/);
  });

  it("reports the zero-balance message when no credits remain", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(1);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ xPostingCredits: 0 });

    await expect(checkAndDeductXCredits("u1", ["x1"])).rejects.toThrow("no X posting credits remaining");
  });
});

describe("refundXCredits", () => {
  it("increments the balance", async () => {
    await refundXCredits("u1", 3);

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { xPostingCredits: { increment: 3 } },
    });
  });

  it("does nothing for a non-positive amount", async () => {
    await refundXCredits("u1", 0);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("refundXCreditsForFailedResults", () => {
  it("refunds only X results that failed without a root post id", async () => {
    await refundXCreditsForFailedResults("u1", [
      { accountId: "a1", platform: "x", success: false },
      { accountId: "a2", platform: "x", success: true, postId: "1" },
      // Thread root went out before a later segment failed: keep the charge.
      { accountId: "a3", platform: "x", success: false, postId: "2" },
      { accountId: "a4", platform: "telegram", success: false },
    ]);

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { xPostingCredits: { increment: 1 } },
    });
  });

  it("swallows refund errors so they don't mask the publish failure", async () => {
    prismaMock.user.update.mockRejectedValue(new Error("db down"));

    await expect(
      refundXCreditsForFailedResults("u1", [{ accountId: "a1", platform: "x", success: false }]),
    ).resolves.toBeUndefined();
  });
});

describe("refundXCreditsForDiscardedPost", () => {
  it("refunds X accounts of a scheduled post", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(2);

    await refundXCreditsForDiscardedPost("u1", { status: "scheduled", accountIds: ["x1", "x2", "t1"] });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { xPostingCredits: { increment: 2 } },
    });
  });

  it.each(["draft", "published", "failed"])("does not refund a %s post", async (status) => {
    await refundXCreditsForDiscardedPost("u1", { status, accountIds: ["x1"] });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
