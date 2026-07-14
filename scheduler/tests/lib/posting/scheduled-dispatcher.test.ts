import { isSocialPlatformEnabled } from "@/lib/config";
import { postToAccounts, repostToAccounts } from "@/lib/posting";
import type { PostingResult } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: jest.fn() }));

jest.mock("@/lib/prisma", () => ({
  prisma: {
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
  prismaMock.post.update.mockResolvedValue({});
  prismaMock.post.findFirst.mockResolvedValue(null);
  mockUpdateMany({});
});

describe("dispatchDueScheduledPosts", () => {
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

    expect(postToAccountsMock).toHaveBeenCalledWith("user-1", "hello", [], ["a1"], undefined, undefined, undefined, [
      expect.objectContaining({ accountId: "a1", postId: "source-tweet" }),
    ]);
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

    expect(postToAccountsMock).toHaveBeenCalledWith("user-1", "hello", [], ["a1"], undefined, undefined, undefined, [
      expect.objectContaining({ accountId: "a1", postId: "successful-source-tweet" }),
    ]);
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
    prismaMock.post.count.mockResolvedValue(14);
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
    prismaMock.post.count.mockResolvedValue(10);

    const result = await dispatchDueScheduledPosts();

    expect(postToAccountsMock).not.toHaveBeenCalled();
    expect(result.skippedPosts).toBe(1);
  });
});
