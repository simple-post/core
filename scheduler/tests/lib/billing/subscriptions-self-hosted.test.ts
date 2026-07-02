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

  it("requires a subscription record for an active status", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: null });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    const status = await getBillingStatus("user-1");

    expect(status.active).toBe(false);
    expect(status.plan).toBeNull();
  });

  it("rejects the active subscription assertion without a subscription", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: null });
    mockPrisma.connectedAccount.count.mockResolvedValue(0);
    mockPrisma.post.count.mockResolvedValue(0);

    await expect(assertActiveSubscription("user-1")).rejects.toThrow("An active SimplePost subscription is required");
  });
});
