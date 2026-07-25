import { Prisma } from "@prisma/client";

import {
  calculateTrialEnd,
  ensureTrialStarted,
  getTrialDaysRemaining,
  getTrialPlatformUsage,
} from "@/lib/billing/trial";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    freeTrial: { create: jest.fn(), findUnique: jest.fn() },
    post: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  freeTrial: { create: jest.Mock; findUnique: jest.Mock };
  post: { findMany: jest.Mock };
};

const NOW = new Date("2026-07-25T12:00:00.000Z");

function trialRow(overrides: Partial<{ startsAt: Date; expiresAt: Date }> = {}) {
  return {
    id: "trial-1",
    userId: "user-1",
    startsAt: new Date("2026-07-20T12:00:00.000Z"),
    expiresAt: new Date("2026-07-27T12:00:00.000Z"),
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("ensureTrialStarted", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_HOSTED;
  });

  it("creates a 7-day trial for a user with no access at all", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: null,
      complimentaryAccess: null,
    });
    const created = trialRow({ startsAt: NOW, expiresAt: calculateTrialEnd(NOW) });
    mockPrisma.freeTrial.create.mockResolvedValue(created);

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBe(created);
    expect(mockPrisma.freeTrial.create).toHaveBeenCalledWith({
      data: { userId: "user-1", startsAt: NOW, expiresAt: new Date("2026-08-01T12:00:00.000Z") },
    });
  });

  it("never restarts a trial that has already expired", async () => {
    const expired = trialRow({
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: expired,
      subscription: null,
      complimentaryAccess: null,
    });

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBe(expired);
    expect(mockPrisma.freeTrial.create).not.toHaveBeenCalled();
  });

  it("skips users who already pay", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: { id: "sub-1" },
      complimentaryAccess: null,
    });

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBeNull();
    expect(mockPrisma.freeTrial.create).not.toHaveBeenCalled();
  });

  it("skips users holding a complimentary grant", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: null,
      complimentaryAccess: { id: "comp-1" },
    });

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBeNull();
    expect(mockPrisma.freeTrial.create).not.toHaveBeenCalled();
  });

  it("does not hand a churned customer a fresh trial", async () => {
    // The subscription row survives cancellation, which is what marks this
    // user as someone who has already had paid access.
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: { id: "sub-1" },
      complimentaryAccess: null,
    });

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBeNull();
    expect(mockPrisma.freeTrial.create).not.toHaveBeenCalled();
  });

  it("does not hand a trial to someone whose complimentary grant expired", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: null,
      complimentaryAccess: { id: "comp-1" },
    });

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBeNull();
    expect(mockPrisma.freeTrial.create).not.toHaveBeenCalled();
  });

  it("returns the winner's row when two concurrent calls race", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      freeTrial: null,
      subscription: null,
      complimentaryAccess: null,
    });
    const winner = trialRow();
    mockPrisma.freeTrial.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.16.3",
      }),
    );
    mockPrisma.freeTrial.findUnique.mockResolvedValue(winner);

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBe(winner);
  });

  it("does nothing in self-hosted mode", async () => {
    process.env.SELF_HOSTED = "true";

    await expect(ensureTrialStarted("user-1", NOW)).resolves.toBeNull();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("getTrialPlatformUsage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("charges one slot per account publish", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { accounts: [{ platform: "x" }, { platform: "x" }, { platform: "bluesky" }] },
      { accounts: [{ platform: "x" }] },
    ]);

    await expect(getTrialPlatformUsage("user-1", trialRow())).resolves.toEqual({ x: 3, bluesky: 1 });
  });

  it("counts legacy twitter accounts against the X allowance", async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { accounts: [{ platform: "twitter" }] },
      { accounts: [{ platform: "X" }] },
    ]);

    await expect(getTrialPlatformUsage("user-1", trialRow())).resolves.toEqual({ x: 2 });
  });

  it("only counts posts created inside the trial window, excluding drafts", async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    const trial = trialRow();

    await getTrialPlatformUsage("user-1", trial);

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        createdAt: { gte: trial.startsAt },
        status: { notIn: ["draft"] },
      },
      select: { accounts: { select: { platform: true } } },
    });
  });
});

describe("getTrialDaysRemaining", () => {
  it("rounds up so a partial last day still counts", () => {
    const trial = trialRow({ expiresAt: new Date("2026-07-26T06:00:00.000Z") });
    expect(getTrialDaysRemaining(trial, NOW)).toBe(1);
  });

  it("reports zero once the trial has ended", () => {
    const trial = trialRow({ expiresAt: new Date("2026-07-24T12:00:00.000Z") });
    expect(getTrialDaysRemaining(trial, NOW)).toBe(0);
  });
});
