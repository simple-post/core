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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  post: { count: jest.Mock };
  connectedAccount: { count: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
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
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "vladimir@example.com",
      subscription: {
        status: "past_due",
        planKey: "basic",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: null,
        currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2099-07-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
      },
      complimentaryAccess: null,
    });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    await expect(assertActiveSubscription("user-1", { action: "oauth_authorize" })).rejects.toMatchObject({
      message: "An active SimplePost subscription is required",
      logContext: {
        userId: "user-1",
        maskedEmail: "vl***ir@example.com",
        action: "oauth_authorize",
        billingActive: false,
        accessType: "none",
        planKey: null,
        subscriptionStatus: "past_due",
      },
    });
  });

  it("logs the complimentary plan and exact social account when the account limit is reached", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "invitee@example.com",
      subscription: null,
      complimentaryAccess: {
        planKey: "basic",
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2026-10-01T00:00:00.000Z"),
        source: "invite",
      },
    });
    mockPrisma.connectedAccount.findUnique.mockResolvedValue(null);
    mockPrisma.connectedAccount.count.mockResolvedValue(5);
    mockPrisma.post.count.mockResolvedValue(3);

    await expect(
      assertCanConnectAccount({
        userId: "user-1",
        platform: "x",
        platformAccountId: "123456789",
        accountLabel: "@simplepost",
      }),
    ).rejects.toMatchObject({
      logContext: {
        userId: "user-1",
        maskedEmail: "in***ee@example.com",
        action: "connect_social_account",
        accessType: "complimentary",
        planKey: "basic",
        subscriptionStatus: "none",
        complimentaryPlanKey: "basic",
        platform: "x",
        platformAccountId: "123456789",
        accountLabel: "@simplepost",
      },
    });
  });

  it("resolves the exact social account for an account-specific billing denial", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "account-owner@example.com",
      subscription: null,
      complimentaryAccess: null,
    });
    mockPrisma.connectedAccount.count.mockResolvedValue(1);
    mockPrisma.connectedAccount.findFirst.mockResolvedValue({
      platform: "linkedin",
      platformAccountId: "urn:li:person:abc123",
      username: "vladimir-haltakov",
      displayName: "Vladimir Haltakov",
    });

    await expect(
      assertActiveSubscription("user-1", {
        action: "disconnect_social_account",
        connectedAccountId: "account-1",
      }),
    ).rejects.toMatchObject({
      logContext: {
        userId: "user-1",
        maskedEmail: "ac***er@example.com",
        action: "disconnect_social_account",
        connectedAccountId: "account-1",
        platform: "linkedin",
        platformAccountId: "urn:li:person:abc123",
        accountLabel: "vladimir-haltakov",
      },
    });
  });
});
