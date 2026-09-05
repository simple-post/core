import { isSocialPlatformEnabled } from "@/lib/config";
import { postToAccounts, repostToAccounts } from "@/lib/posting";
import type { PostingResult } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";
import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { dispatchPostWebhooks } from "@/lib/webhooks";

jest.mock("@/lib/webhooks", () => ({ dispatchPostWebhooks: jest.fn() }));

jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: jest.fn() }));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    publishAttempt: { count: jest.fn(), deleteMany: jest.fn(), groupBy: jest.fn() },
    publishCheckpoint: { findMany: jest.fn() },
    post: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    connectedAccount: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    webhookEndpoint: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/posting", () => ({
  postToAccounts: jest.fn(),
  repostToAccounts: jest.fn(),
  getPostingSummary: (results: Array<{ success: boolean }>) => {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;
    return { successCount, failureCount, overallSuccess: successCount > 0 && failureCount === 0 };
  },
}));

jest.mock("@/lib/validation/sdk-validation", () => ({
  validatePostForAccounts: jest.fn(),
}));

jest.mock("@simple-post/sdk", () => ({
  isThreadCapable: (platform: string) => ["x", "threads", "bluesky", "mastodon"].includes(platform),
  isRepostCapablePlatform: (platform: string) => ["x", "bluesky", "threads", "linkedin"].includes(platform),
  isQuoteCapablePlatform: (platform: string) => ["x", "bluesky", "threads", "linkedin"].includes(platform),
}));

const prismaMock = prisma as unknown as {
  post: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
  connectedAccount: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  webhookEndpoint: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
};
const postToAccountsMock = postToAccounts as jest.Mock;
const repostToAccountsMock = repostToAccounts as jest.Mock;
const isSocialPlatformEnabledMock = isSocialPlatformEnabled as jest.MockedFunction<typeof isSocialPlatformEnabled>;
const validatePostForAccountsMock = validatePostForAccounts as jest.MockedFunction<typeof validatePostForAccounts>;

interface DuePostFixture {
  id: string;
  message?: string;
  accountOptions?: unknown;
  accountOverrides?: unknown;
  thread?: unknown;
  accountResults?: unknown;
  media?: unknown[];
  accounts: Array<{ id: string; platform: string }>;
  quotePostId?: string | null;
  quotePost?: { status: string } | null;
}

function duePost(fixture: DuePostFixture) {
  return {
    userId: "user-1",
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    scheduledFor: new Date("2026-09-01T11:00:00Z"),
    repostDueAt: new Date("2026-09-01T12:00:00Z"),
    message: "hello",
    accountOptions: null,
    accountOverrides: null,
    thread: null,
    accountResults: null,
    repostEnabled: false,
    repostDelayHours: 12,
    quotePostId: null,
    quotePost: null,
    media: [],
    ...fixture,
  };
}

function dueRepost(fixture: DuePostFixture) {
  return {
    userId: "user-1",
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    scheduledFor: new Date("2026-09-01T11:00:00Z"),
    repostDueAt: new Date("2026-09-01T12:00:00Z"),
    message: "hello",
    accountOptions: null,
    accountResults: null,
    repostDelayHours: 12,
    ...fixture,
  };
}

function successFor(accountIds: string[], platform = "x"): PostingResult[] {
  return accountIds.map((accountId) => ({
    accountId,
    platform,
    success: true,
    postId: `post-${accountId}`,
  }));
}

/**
 * Routes prisma.post.updateMany calls: the stale-pending sweep matches
 * `where.status === "pending"`, claims match `where.status === "scheduled"`.
 */
function mockUpdateMany({
  claims = {},
  repostClaims = {},
}: {
  claims?: Record<string, number>;
  repostClaims?: Record<string, number>;
}) {
  prismaMock.post.updateMany.mockImplementation(
    ({ where }: { where: { status?: string; repostStatus?: string; id?: unknown } }) => {
      if (where.status === "pending") {
        if (typeof where.id === "string") return Promise.resolve({ count: 1 });
        const ids = (where.id as { in?: string[] } | undefined)?.in ?? [];
        return Promise.resolve({ count: ids.length });
      }
      if (where.repostStatus === "pending") {
        const ids = (where.id as { in?: string[] } | undefined)?.in ?? [];
        return Promise.resolve({ count: ids.length });
      }
      if (where.status === "scheduled" && typeof where.id === "string") {
        return Promise.resolve({ count: claims[where.id] ?? 1 });
      }
      if (where.repostStatus === "scheduled" && typeof where.id === "string") {
        return Promise.resolve({ count: repostClaims[where.id] ?? 1 });
      }
      throw new Error(`Unexpected updateMany where: ${JSON.stringify(where)}`);
    },
  );
}

/**
 * Routes prisma.post.findMany calls: the stale-pending sweep queries
 * `where.status === "pending"`, the due-post fetch `where.status === "scheduled"`.
 */
function mockFindMany({
  due = [],
  dueReposts = [],
  stale = [],
  staleReposts = [],
}: {
  due?: unknown[];
  dueReposts?: unknown[];
  stale?: Array<{ id: string; userId: string; message: string }>;
  staleReposts?: Array<{ id: string }>;
}) {
  prismaMock.post.findMany.mockImplementation(({ where }: { where: { status?: string; repostStatus?: string } }) => {
    if (where.status === "pending") return Promise.resolve(stale);
    if (where.repostStatus === "pending") return Promise.resolve(staleReposts);
    if (where.status === "scheduled") return Promise.resolve(due);
    if (where.status === "published" && where.repostStatus === "scheduled") return Promise.resolve(dueReposts);
    throw new Error(`Unexpected findMany where: ${JSON.stringify(where)}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  isSocialPlatformEnabledMock.mockReturnValue(true);
  prismaMock.user.findUnique.mockResolvedValue({
    subscription: {
      status: "active",
      planKey: "pro",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      stripePriceId: "price_pro",
      currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEndsAt: null,
    },
  });
  prismaMock.connectedAccount.count.mockResolvedValue(1);
  prismaMock.connectedAccount.findMany.mockResolvedValue([]);
  prismaMock.webhookEndpoint.findMany.mockResolvedValue([]);
  mockFindMany({});
  prismaMock.post.count.mockResolvedValue(0);
  jest.mocked(prisma.publishAttempt.count).mockResolvedValue(0);
  jest.mocked(prisma.publishAttempt.deleteMany).mockResolvedValue({ count: 0 });
  jest.mocked(prisma.publishAttempt.groupBy).mockResolvedValue([]);
  jest.mocked(prisma.publishCheckpoint.findMany).mockResolvedValue([]);
  prismaMock.post.update.mockResolvedValue({});
  prismaMock.post.findFirst.mockResolvedValue(null);
  validatePostForAccountsMock.mockImplementation(async ({ accountIds }) => ({
    platforms: ["x"],
    results: [],
    summary: { errors: [], warnings: [], isValid: true },
    accounts: accountIds.map((id) => ({ id })) as Awaited<ReturnType<typeof validatePostForAccounts>>["accounts"],
  }));
  mockUpdateMany({});
});

describe("dispatchDueScheduledPosts", () => {
  it.each(["edited", "rescheduled"])("does not publish a snapshot that was %s after selection", async (change) => {
    const selected = duePost({ id: "p1", accounts: [{ id: "a1", platform: "x" }] });
    mockFindMany({ due: [selected] });
    const currentUpdatedAt = new Date(selected.updatedAt.getTime() + 1000);
    const currentScheduledFor = change === "rescheduled" ? new Date(Date.now() + 60_000) : selected.scheduledFor;
    prismaMock.post.updateMany.mockImplementation(async ({ where }) => ({
      count:
        where.updatedAt?.getTime() === currentUpdatedAt.getTime() &&
        where.scheduledFor?.getTime() === currentScheduledFor.getTime()
          ? 1
          : 0,
    }));

    const result = await dispatchDueScheduledPosts();

    expect(result.processedPosts).toBe(0);
    expect(result.skippedPosts).toBe(1);
    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: selected.id,
          status: "scheduled",
          updatedAt: selected.updatedAt,
          scheduledFor: selected.scheduledFor,
        },
      }),
    );
  });

  it("does not auto-repost a snapshot changed after selection", async () => {
    const selected = dueRepost({
      id: "p1",
      accounts: [{ id: "a1", platform: "x" }],
      accountResults: toAccountResultsMap(successFor(["a1"])),
    });
    mockFindMany({ dueReposts: [selected] });
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });

    const result = await dispatchDueScheduledPosts();

    expect(result.processedReposts).toBe(0);
    expect(repostToAccountsMock).not.toHaveBeenCalled();
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: selected.id,
          status: "published",
          repostStatus: "scheduled",
          updatedAt: selected.updatedAt,
          repostDueAt: selected.repostDueAt,
        },
      }),
    );
  });

  it("only emits recovery webhooks for posts this run actually recovered", async () => {
    mockFindMany({
      stale: [
        { id: "recovered", userId: "u1", message: "stuck" },
        { id: "completed-elsewhere", userId: "u1", message: "already published" },
      ],
    });
    prismaMock.post.updateMany.mockImplementation(async ({ where }) => ({ count: where.id === "recovered" ? 1 : 0 }));

    const result = await dispatchDueScheduledPosts();

    expect(result.staleRecoveredPosts).toBe(1);
    expect(dispatchPostWebhooks).toHaveBeenCalledTimes(1);
    expect(dispatchPostWebhooks).toHaveBeenCalledWith(
      "u1",
      "post.failed",
      expect.objectContaining({ id: "recovered" }),
    );
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "completed-elsewhere", status: "pending", updatedAt: { lt: expect.any(Date) } },
      }),
    );
  });

  it("rechecks the stale cutoff when recovering reposts", async () => {
    mockFindMany({ staleReposts: [{ id: "r1" }] });
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });
    const result = await dispatchDueScheduledPosts();
    expect(result.staleRecoveredReposts).toBe(0);
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["r1"] }, repostStatus: "pending", updatedAt: { lt: expect.any(Date) } },
      }),
    );
  });

  it("returns an empty result when no posts are due", async () => {
    const result = await dispatchDueScheduledPosts();

    expect(result.processedPosts).toBe(0);
    expect(result.publishedPosts).toBe(0);
    expect(result.failedPosts).toBe(0);
    expect(result.skippedPosts).toBe(0);
    expect(result.processedReposts).toBe(0);
    expect(result.completedReposts).toBe(0);
    expect(result.failedReposts).toBe(0);
    expect(result.skippedReposts).toBe(0);
    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(repostToAccountsMock).not.toHaveBeenCalled();
  });

  it("recovers stale pending posts and reports the count", async () => {
    mockFindMany({
      stale: [
        { id: "s1", userId: "u1", message: "stuck 1" },
        { id: "s2", userId: "u1", message: "stuck 2" },
        { id: "s3", userId: "u2", message: "stuck 3" },
      ],
    });

    const result = await dispatchDueScheduledPosts();

    expect(result.staleRecoveredPosts).toBe(3);
  });

  it("recovers stale pending reposts and reports the count", async () => {
    mockFindMany({
      staleReposts: [{ id: "r1" }, { id: "r2" }],
    });

    const result = await dispatchDueScheduledPosts();

    expect(result.staleRecoveredReposts).toBe(2);
  });

  it("publishes claimed posts and skips posts another run already claimed", async () => {
    mockFindMany({
      due: [
        duePost({ id: "p1", accounts: [{ id: "a1", platform: "x" }] }),
        duePost({ id: "p2", accounts: [{ id: "a2", platform: "x" }] }),
      ],
    });
    mockUpdateMany({ claims: { p1: 1, p2: 0 } });
    postToAccountsMock.mockResolvedValue(successFor(["a1"]));

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).toHaveBeenCalledTimes(1);
    expect(result.processedPosts).toBe(1);
    expect(result.publishedPosts).toBe(1);
    expect(result.skippedPosts).toBe(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "published" }),
      }),
    );
  });

  it("remeasures and rejects invalid media before dispatching a scheduled post", async () => {
    const media = [
      {
        id: "media-1",
        url: "https://cdn.example.com/oversized.png",
        type: "image" as const,
        filename: "oversized.png",
        size: 0,
      },
    ];
    mockFindMany({
      due: [duePost({ id: "p1", media, accounts: [{ id: "a1", platform: "x" }] })],
    });
    validatePostForAccountsMock.mockResolvedValue({
      platforms: ["x"],
      results: [],
      summary: {
        errors: [
          {
            platform: "x",
            severity: "error",
            code: "image_too_large",
            message: "X images cannot exceed 5 MB.",
          },
        ],
        warnings: [],
        isValid: false,
      },
      accounts: [{ id: "a1" }] as Awaited<ReturnType<typeof validatePostForAccounts>>["accounts"],
    });

    const result = await dispatchDueScheduledPosts();

    expect(validatePostForAccountsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", media, accountIds: ["a1"] }),
    );
    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.failedPosts).toBe(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "Scheduled post failed validation: X images cannot exceed 5 MB.",
        }),
      }),
    );
  });

  it("defers scheduled posts while one of their providers is disabled", async () => {
    mockFindMany({
      due: [duePost({ id: "p1", accounts: [{ id: "a1", platform: "forem" }] })],
    });
    isSocialPlatformEnabledMock.mockImplementation((platform) => platform !== "forem");

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.processedPosts).toBe(0);
    expect(result.skippedPosts).toBe(1);
    expect(prismaMock.post.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "p1", status: "scheduled" }) }),
    );
  });

  it("defers a scheduled quote until its source post is published", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "quote-1",
          quotePostId: "source-1",
          quotePost: { status: "scheduled" },
          accounts: [{ id: "a1", platform: "x" }],
        }),
      ],
    });

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.processedPosts).toBe(0);
    expect(result.skippedPosts).toBe(1);
  });

  it("publishes a due source before its quote in the same dispatch run", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "quote-1",
          quotePostId: "source-1",
          quotePost: { status: "scheduled" },
          accounts: [{ id: "quote-account", platform: "x" }],
        }),
        duePost({
          id: "source-1",
          accounts: [{ id: "source-account", platform: "x" }],
        }),
      ],
    });
    prismaMock.post.findFirst.mockResolvedValue({
      status: "published",
      accounts: [{ id: "source-account", platform: "x" }],
      accountResults: toAccountResultsMap([
        { accountId: "source-account", platform: "x", success: true, postId: "source-tweet" },
      ]),
    });
    const publishOrder: string[] = [];
    postToAccountsMock.mockImplementation(
      async (_userId: string, _message: string, _media: unknown[], accountIds: string[]) => {
        publishOrder.push(accountIds[0]);
        return successFor(accountIds);
      },
    );

    const result = await dispatchDueScheduledPosts();

    expect(publishOrder).toEqual(["source-account", "quote-account"]);
    expect(result.processedPosts).toBe(2);
    expect(result.publishedPosts).toBe(2);
  });

  it("does not claim a quote when another run claimed its due source first", async () => {
    mockFindMany({
      due: [
        duePost({ id: "source-1", accounts: [{ id: "source-account", platform: "x" }] }),
        duePost({
          id: "quote-1",
          quotePostId: "source-1",
          quotePost: { status: "scheduled" },
          accounts: [{ id: "quote-account", platform: "x" }],
        }),
      ],
    });
    mockUpdateMany({ claims: { "source-1": 0, "quote-1": 1 } });

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.processedPosts).toBe(0);
    expect(result.skippedPosts).toBe(2);
    expect(prismaMock.post.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "quote-1" }) }),
    );
  });

  it("resolves platform targets when dispatching a quote", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "quote-1",
          quotePostId: "source-1",
          quotePost: { status: "published" },
          accounts: [{ id: "a1", platform: "x" }],
        }),
      ],
    });
    prismaMock.post.findFirst.mockResolvedValue({
      status: "published",
      accounts: [{ id: "a1", platform: "x" }],
      accountResults: toAccountResultsMap([{ accountId: "a1", platform: "x", success: true, postId: "source-tweet" }]),
    });
    postToAccountsMock.mockResolvedValue(successFor(["a1"]));

    await dispatchDueScheduledPosts();

    expect(postToAccountsMock).toHaveBeenCalledWith(
      "user-1",
      "hello",
      [],
      ["a1"],
      undefined,
      undefined,
      undefined,
      [expect.objectContaining({ accountId: "a1", postId: "source-tweet" })],
      undefined,
      expect.objectContaining({ postId: "quote-1", source: "scheduler" }),
    );
  });

  it("quotes successful platform results from a partially failed source", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "quote-1",
          quotePostId: "source-1",
          quotePost: { status: "failed" },
          accounts: [{ id: "a1", platform: "x" }],
        }),
      ],
    });
    prismaMock.post.findFirst.mockResolvedValue({
      status: "failed",
      accounts: [{ id: "a1", platform: "x" }],
      accountResults: toAccountResultsMap([
        { accountId: "a1", platform: "x", success: true, postId: "successful-source-tweet" },
      ]),
    });
    postToAccountsMock.mockResolvedValue(successFor(["a1"]));

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).toHaveBeenCalledWith(
      "user-1",
      "hello",
      [],
      ["a1"],
      undefined,
      undefined,
      undefined,
      [expect.objectContaining({ accountId: "a1", postId: "successful-source-tweet" })],
      undefined,
      expect.objectContaining({ postId: "quote-1", source: "scheduler" }),
    );
    expect(result.publishedPosts).toBe(1);
  });

  it("dispatches due reposts for successful repost-capable account results", async () => {
    mockFindMany({
      dueReposts: [
        dueRepost({
          id: "p1",
          accounts: [{ id: "a1", platform: "x" }],
          accountResults: toAccountResultsMap([{ accountId: "a1", platform: "x", success: true, postId: "tweet-1" }]),
        }),
      ],
    });
    repostToAccountsMock.mockResolvedValue(successFor(["a1"]));

    const result = await dispatchDueScheduledPosts();

    expect(repostToAccountsMock).toHaveBeenCalledWith(
      "user-1",
      [expect.objectContaining({ accountId: "a1", postId: "tweet-1" })],
      undefined,
      { content: "hello", postId: "p1", source: "scheduler" },
    );
    expect(result.processedReposts).toBe(1);
    expect(result.completedReposts).toBe(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ repostStatus: "completed" }),
      }),
    );
  });

  it("publishes only to accounts without a recorded success", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "p1",
          accounts: [
            { id: "a1", platform: "x" },
            { id: "a2", platform: "telegram" },
          ],
          accountResults: toAccountResultsMap([{ accountId: "a1", platform: "x", success: true, postId: "1" }]),
        }),
      ],
    });
    postToAccountsMock.mockResolvedValue(successFor(["a2"], "telegram"));

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).toHaveBeenCalledTimes(1);
    expect(postToAccountsMock.mock.calls[0][3]).toEqual(["a2"]);
    expect(result.publishedPosts).toBe(1);
  });

  it("marks a post published without publishing when every account already succeeded", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "p1",
          accounts: [{ id: "a1", platform: "x" }],
          accountResults: toAccountResultsMap([{ accountId: "a1", platform: "x", success: true, postId: "1" }]),
        }),
      ],
    });

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.publishedPosts).toBe(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: "published" }),
      }),
    );
  });

  it("marks a post failed and records per-account results on partial failure", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "p1",
          accounts: [
            { id: "a1", platform: "x" },
            { id: "a2", platform: "telegram" },
          ],
        }),
      ],
    });
    postToAccountsMock.mockResolvedValue([
      { accountId: "a1", platform: "x", success: true, postId: "1" },
      { accountId: "a2", platform: "telegram", success: false, error: "API_ERROR", message: "boom" },
    ]);

    const result = await dispatchDueScheduledPosts();

    expect(result.failedPosts).toBe(1);
    const updateData = prismaMock.post.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("failed");
    expect(updateData.accountResults).toMatchObject({
      a1: expect.objectContaining({ success: true }),
      a2: expect.objectContaining({ success: false }),
    });
  });

  it("defers posts beyond the per-platform rate budget", async () => {
    mockFindMany({
      due: [
        duePost({ id: "p1", accounts: [{ id: "a1", platform: "x" }] }),
        duePost({ id: "p2", accounts: [{ id: "a2", platform: "x" }] }),
      ],
    });
    // 14 of 15 per-minute slots already used: only one post fits.
    jest.mocked(prisma.publishAttempt.count).mockResolvedValue(14);
    postToAccountsMock.mockResolvedValue(successFor(["a1"]));

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).toHaveBeenCalledTimes(1);
    expect(result.processedPosts).toBe(1);
    expect(result.skippedPosts).toBe(1);
    const xSummary = result.platformSummary.find((entry) => entry.platform === "x");
    expect(xSummary?.queued).toBe(1);
  });

  it("accounts for thread segments in the rate budget on thread-capable platforms", async () => {
    mockFindMany({
      due: [
        duePost({
          id: "p1",
          accounts: [{ id: "a1", platform: "x" }],
          // Root + 5 segments = 6 slots on a thread-capable platform.
          thread: [{}, {}, {}, {}, {}],
        }),
      ],
    });
    // Only 5 slots left -> the 6-slot thread does not fit.
    jest.mocked(prisma.publishAttempt.count).mockResolvedValue(10);

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.skippedPosts).toBe(1);
  });
});

jest.mock("@/lib/utils/storage-lifecycle", () => ({ collectUnusedStorage: jest.fn().mockResolvedValue(undefined) }));

it("counts separate accounts on one platform in the thread budget", async () => {
  mockFindMany({
    due: [
      duePost({
        id: "multi",
        accounts: [
          { id: "a1", platform: "x" },
          { id: "a2", platform: "twitter" },
        ],
        thread: [{}, {}],
      }),
    ],
  });
  jest.mocked(prisma.publishAttempt.count).mockResolvedValue(10);
  const result = await dispatchDueScheduledPosts();
  expect(postToAccountsMock).not.toHaveBeenCalled();
  expect(result.skippedPosts).toBe(1);
});

it("uses an account's thread override rather than the shared thread cost", async () => {
  mockFindMany({
    due: [
      duePost({
        id: "overridden",
        accounts: [{ id: "a1", platform: "x" }],
        thread: [],
        accountOverrides: { a1: { thread: [{}, {}, {}, {}, {}] } },
      }),
    ],
  });
  jest.mocked(prisma.publishAttempt.count).mockResolvedValue(10);
  await dispatchDueScheduledPosts();
  expect(postToAccountsMock).not.toHaveBeenCalled();
});

it("deducts successful checkpoints when estimating a partial retry", async () => {
  mockFindMany({
    due: [duePost({ id: "partial", accounts: [{ id: "a1", platform: "x" }], thread: [{}, {}, {}, {}, {}] })],
  });
  jest.mocked(prisma.publishAttempt.count).mockResolvedValue(14);
  jest
    .mocked(prisma.publishCheckpoint.findMany)
    .mockResolvedValue(Array.from({ length: 5 }, (_, segment) => ({ accountId: "a1", segment })) as never);
  postToAccountsMock.mockResolvedValue(successFor(["a1"]));
  await dispatchDueScheduledPosts();
  expect(postToAccountsMock).toHaveBeenCalledTimes(1);
});

it("reschedules a partial thread when another process consumes the remaining capacity", async () => {
  mockFindMany({ due: [duePost({ id: "limited", accounts: [{ id: "a1", platform: "x" }] })] });
  postToAccountsMock.mockResolvedValue([
    {
      accountId: "a1",
      platform: "x",
      success: false,
      error: "LOCAL_RATE_LIMIT",
      threadResults: [
        { index: 0, success: true, postId: "saved-root" },
        { index: 1, success: false, error: "LOCAL_RATE_LIMIT" },
      ],
    },
  ]);
  const result = await dispatchDueScheduledPosts();
  expect(result.failedPosts).toBe(0);
  expect(prismaMock.post.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "scheduled",
        scheduledFor: expect.any(Date),
        threadResults: { a1: expect.arrayContaining([expect.objectContaining({ postId: "saved-root" })]) },
      }),
    }),
  );
  expect(dispatchPostWebhooks).not.toHaveBeenCalledWith(expect.anything(), "post.failed", expect.anything());
});

it("allows a thread larger than one rate window to start making progress", async () => {
  mockFindMany({
    due: [
      duePost({ id: "long", accounts: [{ id: "a1", platform: "x" }], thread: Array.from({ length: 20 }, () => ({})) }),
    ],
  });
  postToAccountsMock.mockResolvedValue(successFor(["a1"]));
  await dispatchDueScheduledPosts();
  expect(postToAccountsMock).toHaveBeenCalledTimes(1);
});
