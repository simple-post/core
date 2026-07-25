import { assertCanCreatePost, getBillingStatus } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    post: { count: jest.fn(), findMany: jest.fn() },
    connectedAccount: { count: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  post: { count: jest.Mock; findMany: jest.Mock };
  connectedAccount: { count: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
};

const NOW = new Date("2026-07-25T12:00:00.000Z");

const ACTIVE_TRIAL = {
  id: "trial-1",
  userId: "user-1",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  expiresAt: new Date("2026-07-27T12:00:00.000Z"),
  createdAt: new Date("2026-07-20T12:00:00.000Z"),
  updatedAt: new Date("2026-07-20T12:00:00.000Z"),
};

const EXPIRED_TRIAL = {
  ...ACTIVE_TRIAL,
  startsAt: new Date("2026-07-01T12:00:00.000Z"),
  expiresAt: new Date("2026-07-08T12:00:00.000Z"),
};

/** `count` charged publishes on one platform, shaped the way the usage query selects them. */
function postsOnPlatform(platform: string, count: number) {
  return Array.from({ length: count }, () => ({ accounts: [{ platform }] }));
}

describe("free trial billing status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_HOSTED;
    jest.useFakeTimers().setSystemTime(NOW);
    mockPrisma.connectedAccount.count.mockResolvedValue(2);
    mockPrisma.post.count.mockResolvedValue(0);
    mockPrisma.post.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.useRealTimers());

  it("puts a user with only a trial on the trial plan with every feature", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "new@example.com",
      subscription: null,
      complimentaryAccess: null,
      freeTrial: ACTIVE_TRIAL,
    });

    const status = await getBillingStatus("user-1");

    expect(status).toMatchObject({
      active: true,
      accessType: "trial",
      plan: { key: "trial", limits: { cliAccess: true, apiAccess: true, socialAccounts: null } },
      trial: {
        status: "active",
        daysRemaining: 2,
        postsPerPlatform: 10,
        maxThreadSegments: 20,
        expiresAt: "2026-07-27T12:00:00.000Z",
      },
    });
  });

  it("reports an expired trial as inactive but still describes it", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "lapsed@example.com",
      subscription: null,
      complimentaryAccess: null,
      freeTrial: EXPIRED_TRIAL,
    });

    const status = await getBillingStatus("user-1");

    expect(status.active).toBe(false);
    expect(status.accessType).toBeNull();
    expect(status.plan).toBeNull();
    expect(status.trial).toMatchObject({ status: "expired", daysRemaining: 0 });
  });

  it("prefers a paid subscription over an active trial", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "payer@example.com",
      subscription: {
        status: "active",
        planKey: "basic",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: null,
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2099-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
      },
      complimentaryAccess: null,
      freeTrial: ACTIVE_TRIAL,
    });

    const status = await getBillingStatus("user-1");

    expect(status.accessType).toBe("stripe");
    expect(status.plan?.key).toBe("basic");
    // Per-platform usage is trial-only bookkeeping; paying users skip the query.
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  it("prefers a complimentary grant over an active trial", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "invitee@example.com",
      subscription: null,
      complimentaryAccess: {
        planKey: "pro",
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        source: "invite",
      },
      freeTrial: ACTIVE_TRIAL,
    });

    const status = await getBillingStatus("user-1");

    expect(status.accessType).toBe("complimentary");
    expect(status.plan?.key).toBe("pro");
  });
});

describe("free trial post limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SELF_HOSTED;
    jest.useFakeTimers().setSystemTime(NOW);
    mockPrisma.connectedAccount.count.mockResolvedValue(2);
    mockPrisma.post.count.mockResolvedValue(0);
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "new@example.com",
      subscription: null,
      complimentaryAccess: null,
      freeTrial: ACTIVE_TRIAL,
    });
  });

  afterEach(() => jest.useRealTimers());

  it("allows the 10th post on a platform", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 9));

    await expect(
      assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }] }),
    ).resolves.toBeUndefined();
  });

  it("blocks the 11th post on a platform, naming it", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 10));

    await expect(assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }] })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("X (Twitter)"),
    });
  });

  it("leaves other platforms usable when one is exhausted", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 10));

    await expect(
      assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "bluesky" }] }),
    ).resolves.toBeUndefined();
  });

  it("does not charge drafts against the allowance", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 10));

    await expect(
      assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }], isDraft: true }),
    ).resolves.toBeUndefined();
  });

  it("rejects a thread longer than 20 segments", async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);

    await expect(
      assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }], threadSegments: 21 }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("20 posts in a thread"),
    });
  });

  it("allows a thread of exactly 20 segments", async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);

    await expect(
      assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }], threadSegments: 20 }),
    ).resolves.toBeUndefined();
  });

  it("charges the allowance when a draft is scheduled later", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("threads", 10));

    await expect(
      assertCanCreatePost("user-1", prisma, {
        socialAccounts: [{ platform: "threads" }],
        isExistingPostUpdate: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("charges one slot per account, so a post to two X accounts costs two", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 9));

    await expect(
      assertCanCreatePost("user-1", prisma, {
        socialAccounts: [{ platform: "x" }, { platform: "x" }],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("collapses the legacy twitter id into the X allowance", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("twitter", 10));

    await expect(assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }] })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("X (Twitter)"),
    });
  });

  it("does not charge an edit for accounts the post already used", async () => {
    mockPrisma.post.findMany.mockResolvedValue(postsOnPlatform("x", 10));

    await expect(
      assertCanCreatePost("user-1", prisma, {
        socialAccounts: [{ platform: "x" }],
        replacingSocialAccounts: [{ platform: "x" }],
        isExistingPostUpdate: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("charges an edit for a platform the post did not previously target", async () => {
    mockPrisma.post.findMany.mockResolvedValue([...postsOnPlatform("x", 5), ...postsOnPlatform("bluesky", 10)]);

    await expect(
      assertCanCreatePost("user-1", prisma, {
        socialAccounts: [{ platform: "x" }, { platform: "bluesky" }],
        replacingSocialAccounts: [{ platform: "x" }],
        isExistingPostUpdate: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining("Bluesky") });
  });

  it("leaves paid plans on the monthly limit, not the per-platform one", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "payer@example.com",
      subscription: {
        status: "active",
        planKey: "basic",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: null,
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2099-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
      },
      complimentaryAccess: null,
      freeTrial: ACTIVE_TRIAL,
    });
    mockPrisma.post.count.mockResolvedValue(100);

    await expect(assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }] })).rejects.toMatchObject({
      message: expect.stringContaining("100 posts per month"),
    });
  });

  it("lets a paid user at the monthly limit still edit an existing post", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "payer@example.com",
      subscription: {
        status: "active",
        planKey: "basic",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: null,
        currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2099-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
      },
      complimentaryAccess: null,
      freeTrial: null,
    });
    mockPrisma.post.count.mockResolvedValue(100);

    await expect(
      assertCanCreatePost("user-1", prisma, {
        socialAccounts: [{ platform: "x" }],
        isExistingPostUpdate: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("tells an expired-trial user their trial ended instead of demanding a subscription", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "lapsed@example.com",
      subscription: null,
      complimentaryAccess: null,
      freeTrial: EXPIRED_TRIAL,
    });
    mockPrisma.post.findMany.mockResolvedValue([]);

    await expect(assertCanCreatePost("user-1", prisma, { socialAccounts: [{ platform: "x" }] })).rejects.toMatchObject({
      statusCode: 402,
      message: expect.stringContaining("free trial has ended"),
    });
  });
});
