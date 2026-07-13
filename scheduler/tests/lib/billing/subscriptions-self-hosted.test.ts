import {
  assertActiveSubscription,
  assertCanConnectAccount,
  assertCanCreatePost,
  assertPlanFeature,
  getBillingStatus,
} from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    post: {
      count: jest.fn(),
    },
    connectedAccount: {
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  post: { count: jest.Mock };
  connectedAccount: { count: jest.Mock; findUnique: jest.Mock };
};

describe("billing in self-hosted mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SELF_HOSTED = "true";
    mockPrisma.connectedAccount.count.mockResolvedValue(3);
  });

  afterEach(() => {
    delete process.env.SELF_HOSTED;
  });

  it("reports an active billing status without a subscription", async () => {
    const status = await getBillingStatus("user-1");

    expect(status.active).toBe(true);
    expect(status.accessType).toBe("self_hosted");
    expect(status.plan).toBeNull();
    expect(status.subscription).toBeNull();
    expect(status.usage.connectedAccounts).toBe(3);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("passes the active subscription assertion", async () => {
    await expect(assertActiveSubscription("user-1")).resolves.toMatchObject({ active: true });
  });

  it("grants every plan feature", async () => {
    await expect(assertPlanFeature("user-1", "apiAccess")).resolves.toBeUndefined();
    await expect(assertPlanFeature("user-1", "cliAccess")).resolves.toBeUndefined();
  });

  it("allows creating posts without limits", async () => {
    await expect(assertCanCreatePost("user-1")).resolves.toBeUndefined();
  });

  it("allows connecting accounts without limits", async () => {
    await expect(
      assertCanConnectAccount({ userId: "user-1", platform: "x", platformAccountId: "acc-1" }),
    ).resolves.toBeUndefined();
    expect(mockPrisma.connectedAccount.findUnique).not.toHaveBeenCalled();
  });
});

describe("billing when self-hosted mode is off", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_HOSTED;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("requires a subscription record for an active status", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: null });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    const status = await getBillingStatus("user-1");

    expect(status.active).toBe(false);
    expect(status.plan).toBeNull();
  });

  it("uses an active complimentary grant as the effective plan", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    mockPrisma.user.findUnique.mockResolvedValue({
      subscription: null,
      complimentaryAccess: {
        id: "access-1",
        userId: "user-1",
        planKey: "pro",
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2026-10-01T00:00:00.000Z"),
        source: "manual",
        inviteId: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    mockPrisma.connectedAccount.count.mockResolvedValue(2);
    mockPrisma.post.count.mockResolvedValue(15);

    const status = await getBillingStatus("user-1");

    expect(status).toMatchObject({
      active: true,
      accessType: "complimentary",
      plan: { key: "pro" },
      complimentaryAccess: {
        planKey: "pro",
        source: "manual",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
      usage: { connectedAccounts: 2, postsThisPeriod: 15 },
    });
    expect(mockPrisma.post.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        createdAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
    });
  });

  it("does not activate an expired complimentary grant", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      subscription: null,
      complimentaryAccess: {
        planKey: "advanced",
        startsAt: new Date("2025-01-01T00:00:00.000Z"),
        expiresAt: new Date("2025-02-01T00:00:00.000Z"),
        source: "manual",
      },
    });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);

    const status = await getBillingStatus("user-1");

    expect(status.active).toBe(false);
    expect(status.accessType).toBeNull();
    expect(status.plan).toBeNull();
    expect(mockPrisma.post.count).not.toHaveBeenCalled();
  });

  it("prefers an active paid subscription over complimentary access", async () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2099-08-01T00:00:00.000Z");
    mockPrisma.user.findUnique.mockResolvedValue({
      subscription: {
        status: "active",
        planKey: "basic",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
      },
      complimentaryAccess: {
        planKey: "pro",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        source: "manual",
      },
    });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    const status = await getBillingStatus("user-1");

    expect(status.accessType).toBe("stripe");
    expect(status.plan?.key).toBe("basic");
  });

  it("rejects the active subscription assertion without a subscription", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: null });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    await expect(assertActiveSubscription("user-1")).rejects.toThrow("An active SimplePost subscription is required");
  });
});
