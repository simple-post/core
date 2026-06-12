jest.mock("@/lib/prisma", () => {
  const tx = {
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    prisma: {
      connectedAccount: { count: jest.fn() },
      user: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from "@/lib/prisma";
import { checkAndDeductXCredits, getXCredits } from "@/lib/utils/x-credits";

const prismaMock = prisma as unknown as {
  connectedAccount: { count: jest.Mock };
  user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
  __tx: { user: { findUniqueOrThrow: jest.Mock; update: jest.Mock } };
};

beforeEach(() => {
  jest.clearAllMocks();
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

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("deducts one credit per targeted X account", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(2);
    prismaMock.__tx.user.findUniqueOrThrow.mockResolvedValue({ xPostingCredits: 5 });

    await checkAndDeductXCredits("u1", ["x1", "x2"]);

    expect(prismaMock.__tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { xPostingCredits: { decrement: 2 } },
      }),
    );
  });

  it("rejects when the balance is insufficient", async () => {
    prismaMock.connectedAccount.count.mockResolvedValue(2);
    prismaMock.__tx.user.findUniqueOrThrow.mockResolvedValue({ xPostingCredits: 1 });

    await expect(checkAndDeductXCredits("u1", ["x1", "x2"])).rejects.toThrow(/X posting credit/);
    expect(prismaMock.__tx.user.update).not.toHaveBeenCalled();
  });
});
