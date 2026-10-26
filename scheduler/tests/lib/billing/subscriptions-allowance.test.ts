import { getPlanByKey } from "@/lib/billing/plans";
import { assertCanCreatePost, getBillingStatus } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    post: { count: jest.fn() },
    connectedAccount: { count: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  post: { count: jest.Mock };
  connectedAccount: { count: jest.Mock };
};

function paidUser(postsPerMonthOverride: number | null = null, status = "active") {
  return {
    email: "support@example.com",
    subscription: {
      status,
      planKey: "advanced",
      postsPerMonthOverride,
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      stripePriceId: null,
      currentPeriodStart: new Date("2026-10-07T00:00:00Z"),
      currentPeriodEnd: new Date("2099-11-07T00:00:00Z"),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEndsAt: null,
    },
    complimentaryAccess: null,
    freeTrial: null,
  };
}

describe("support-managed paid post allowance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_HOSTED;
    mockPrisma.connectedAccount.count.mockResolvedValue(4);
    mockPrisma.post.count.mockResolvedValue(500);
  });

  it("uses the override for display and enforcement while preserving the plan and other users", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(paidUser(1000));
    const status = await getBillingStatus("supported-user");
    expect(status).toMatchObject({
      active: true,
      accessType: "stripe",
      plan: { key: "advanced", limits: { postsPerMonth: 1000, socialAccounts: 10, apiAccess: false } },
      subscription: { planKey: "advanced", stripeSubscriptionId: "sub_test" },
    });
    mockPrisma.post.count.mockResolvedValue(999);
    await expect(assertCanCreatePost("supported-user")).resolves.toBeUndefined();
    mockPrisma.post.count.mockResolvedValue(1000);
    await expect(assertCanCreatePost("supported-user")).rejects.toMatchObject({
      statusCode: 403,
      message: "Your Advanced plan includes 1,000 posts per month",
    });

    mockPrisma.user.findUnique.mockResolvedValue(paidUser());
    const otherStatus = await getBillingStatus("other-user");
    expect(otherStatus.plan?.limits.postsPerMonth).toBe(500);
    expect(getPlanByKey("advanced")?.limits.postsPerMonth).toBe(500);
    await expect(assertCanCreatePost("other-user")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("does not grant access to an inactive subscription with an override", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(paidUser(1000, "canceled"));
    expect(await getBillingStatus("inactive-user")).toMatchObject({ active: false, plan: null });
    await expect(assertCanCreatePost("inactive-user")).rejects.toMatchObject({ statusCode: 402 });
  });

  it("does not reduce the allowance after upgrading to a larger plan", async () => {
    const user = paidUser(1000);
    user.subscription.planKey = "pro";
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const status = await getBillingStatus("upgraded-user");
    expect(status.plan?.limits.postsPerMonth).toBe(2000);
  });
});
