import { replyToSocialComment } from "@simple-post/sdk";

import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { getPostSocialActivity, getSocialInbox, refreshSocialInbox, sendSocialReply } from "@/lib/social/activity";

jest.mock("@/lib/oauth/credential-health", () => ({ refreshConnectedAccountIfNeeded: jest.fn() }));
jest.mock("@/lib/posting/account-lock", () => ({
  reloadAccountSecrets: jest.fn(),
  withAccountLock: jest.fn(),
}));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (value: unknown) => value,
}));
jest.mock("@simple-post/sdk", () => ({
  getSocialActivityCapabilities: jest.fn(
    (platform: string) => new Set(platform === "x" ? ["metrics", "comments", "mentions", "replies"] : ["metrics"]),
  ),
  getSocialPostMetrics: jest.fn(),
  listSocialMentions: jest.fn(),
  listSocialPostComments: jest.fn(),
  replyToSocialComment: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: jest.fn() },
    connectedAccount: { findMany: jest.fn(), findFirst: jest.fn() },
    socialActivitySync: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    socialActivityItem: { findMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
    socialPostMetric: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    socialActivityReply: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  },
}));

const prismaMock = prisma as unknown as {
  post: { findMany: jest.Mock };
  connectedAccount: { findMany: jest.Mock; findFirst: jest.Mock };
  socialActivitySync: { findMany: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  socialActivityItem: { findMany: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock };
  socialActivityReply: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
};

const account = {
  id: "account-x",
  userId: "user-1",
  platform: "x",
  platformAccountId: "x-user",
  accessToken: "token",
  refreshToken: null,
  tokenMetadata: null,
  tokenType: "Bearer",
  expiresAt: null,
  scope: "tweet.read",
  username: "simplepost",
  displayName: "SimplePost",
  email: null,
  profilePicture: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (withAccountLock as jest.Mock).mockImplementation(async (_id: string, callback: () => unknown) => callback());
  (reloadAccountSecrets as jest.Mock).mockImplementation((value: unknown) => value);
  (refreshConnectedAccountIfNeeded as jest.Mock).mockResolvedValue({ account });
  prismaMock.post.findMany.mockResolvedValue([]);
  prismaMock.connectedAccount.findMany.mockResolvedValue([]);
  prismaMock.connectedAccount.findFirst.mockResolvedValue(account);
  prismaMock.socialActivitySync.findMany.mockResolvedValue([]);
  prismaMock.socialActivitySync.upsert.mockResolvedValue({
    accountId: account.id,
    targetSnapshot: null,
    targetIndex: 0,
    commentCursors: null,
    mentionCursor: null,
    lastCommentsSyncAt: null,
    lastMentionsSyncAt: null,
    updatedAt: new Date("2026-09-14T10:00:00Z"),
  });
  prismaMock.socialActivitySync.update.mockResolvedValue({});
});

it("uses a stable composite cursor, account ownership filter, and safe native links for inbox rows", async () => {
  const firstSeenAt = new Date("2026-09-14T12:00:00Z");
  prismaMock.socialActivityItem.findMany.mockResolvedValue([
    {
      id: "row-2",
      kind: "comment",
      platform: "x",
      accountId: account.id,
      postId: "post-1",
      nativeUrl: "javascript:alert(1)",
      nativePostId: "tweet-1",
      body: "A comment",
      createdAtNative: firstSeenAt,
      firstSeenAt,
      canReply: true,
      author: { name: "Reader" },
      account,
      replies: [],
    },
    {
      id: "row-1",
      kind: "mention",
      platform: "x",
      accountId: account.id,
      postId: null,
      nativeUrl: "https://x.com/simplepost/status/2",
      nativePostId: "tweet-2",
      body: "@simplepost",
      createdAtNative: firstSeenAt,
      firstSeenAt,
      canReply: true,
      author: null,
      account,
      replies: [],
    },
  ]);

  const page = await getSocialInbox("user-1", { accountId: account.id, limit: 1 });

  expect(page.items[0].nativeUrl).toBeUndefined();
  expect(page.nextCursor).toBeDefined();
  expect(prismaMock.socialActivityItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", accountId: account.id }), take: 2 }),
  );
});

it("syncs mentions for an owned account with no SimplePost posts and reaches completion", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([account]);
  const { listSocialMentions } = jest.requireMock("@simple-post/sdk") as { listSocialMentions: jest.Mock };
  listSocialMentions.mockResolvedValue({ ok: true, data: { data: [] } });

  const status = await refreshSocialInbox("user-1", { includeMentions: true });

  expect(listSocialMentions).toHaveBeenCalledTimes(1);
  expect(status.hasMore).toBe(false);
  expect(prismaMock.socialActivitySync.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ mentionCursor: "__complete__" }) }),
  );
});

it("does not report unsupported-account mention work as an endless continuation", async () => {
  const unsupported = { ...account, id: "account-youtube", platform: "youtube" };
  prismaMock.connectedAccount.findMany.mockResolvedValue([unsupported]);
  prismaMock.connectedAccount.findFirst.mockResolvedValue(unsupported);

  const status = await refreshSocialInbox("user-1", { includeMentions: true });

  expect(status.hasMore).toBe(false);
  expect(prismaMock.socialActivitySync.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ mentionCursor: null }) }),
  );
});

it("marks unvisited thread targets on post detail as continuable instead of silently stopping at twelve", async () => {
  const post = {
    id: "post-many-targets",
    createdAt: new Date("2026-09-14T12:00:00Z"),
    publishedAt: new Date("2026-09-14T12:00:00Z"),
    accountResults: {
      [account.id]: {
        accountId: account.id,
        platform: "x",
        success: true,
        postId: "tweet-root",
        postUrl: "https://x.com/simplepost/status/root",
      },
    },
    threadResults: {
      [account.id]: Array.from({ length: 13 }, (_, index) => ({
        success: true,
        postId: `tweet-segment-${index + 1}`,
        postUrl: `https://x.com/simplepost/status/${index + 1}`,
      })),
    },
    accounts: [account],
  };
  prismaMock.post.findMany.mockResolvedValue([post]);
  (prisma as unknown as { socialPostMetric: { findMany: jest.Mock } }).socialPostMetric.findMany.mockResolvedValue([]);
  prismaMock.socialActivityItem.findMany.mockResolvedValue([]);

  const activity = await getPostSocialActivity("user-1", post.id);

  expect(activity.hasMoreComments).toBe(true);
});

it("continues a stable post snapshot across two accounts and starts over only on explicit reset", async () => {
  const noPostAccount = { ...account, id: "account-mentions", platformAccountId: "x-mentions" };
  const syncRows = new Map<string, Record<string, unknown>>();
  let now = 0;
  prismaMock.connectedAccount.findMany.mockResolvedValue([account, noPostAccount]);
  prismaMock.socialActivitySync.findMany.mockImplementation(async () => [...syncRows.values()]);
  prismaMock.socialActivitySync.upsert.mockImplementation(async ({ where }: { where: { accountId: string } }) => {
    const existing = syncRows.get(where.accountId);
    if (existing) return existing;
    const created = {
      accountId: where.accountId,
      targetSnapshot: null,
      targetIndex: 0,
      commentCursors: null,
      mentionCursor: null,
      lastCommentsSyncAt: null,
      lastMentionsSyncAt: null,
      updatedAt: new Date(`2026-09-14T00:00:${String(now++).padStart(2, "0")}Z`),
    };
    syncRows.set(where.accountId, created);
    return created;
  });
  prismaMock.socialActivitySync.update.mockImplementation(
    async ({ where, data }: { where: { accountId: string }; data: Record<string, unknown> }) => {
      const next = {
        ...syncRows.get(where.accountId),
        ...data,
        updatedAt: new Date(`2026-09-14T01:00:${String(now++).padStart(2, "0")}Z`),
      };
      syncRows.set(where.accountId, next);
      return next;
    },
  );
  const posts = Array.from({ length: 26 }, (_, index) => ({
    id: `post-${index + 1}`,
    createdAt: new Date(`2026-08-${String(26 - index).padStart(2, "0")}T12:00:00Z`),
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    accountResults: {
      [account.id]: {
        accountId: account.id,
        platform: "x",
        success: true,
        postId: `tweet-${index + 1}`,
        postUrl: `https://x.com/simplepost/status/${index + 1}`,
      },
    },
    threadResults: null,
    accounts: [account],
  }));
  prismaMock.post.findMany.mockImplementation(async (args: { where: { OR?: unknown[] } }) =>
    args.where.OR ? posts.slice(25) : [...posts.slice(0, 25), posts[25]],
  );
  const sdk = jest.requireMock("@simple-post/sdk") as {
    listSocialPostComments: jest.Mock;
    listSocialMentions: jest.Mock;
  };
  sdk.listSocialPostComments.mockImplementation(async (_account: unknown, target: { nativePostId: string }) => ({
    ok: true,
    data: {
      data: [
        {
          nativeId: `comment-${target.nativePostId}`,
          nativePostId: target.nativePostId,
          body: "reply",
          canReply: true,
        },
      ],
    },
  }));
  sdk.listSocialMentions.mockResolvedValue({ ok: true, data: { data: [] } });

  for (let call = 0; call < 5; call++) await refreshSocialInbox("user-1", { includeMentions: true });
  const traversed = sdk.listSocialPostComments.mock.calls.map(([, target]) => target.nativePostId);
  expect(traversed).toEqual(Array.from({ length: 26 }, (_, index) => `tweet-${index + 1}`));
  expect(new Set(traversed).size).toBe(26);

  const beforeReset = sdk.listSocialPostComments.mock.calls.length;
  await refreshSocialInbox("user-1", { includeMentions: true, reset: true });
  expect(sdk.listSocialPostComments.mock.calls[beforeReset]?.[1].nativePostId).toBe("tweet-1");
  expect(sdk.listSocialPostComments.mock.calls.length - beforeReset).toBeLessThanOrEqual(8);
});

it("records an uncertain reply once and refuses a blind retry with the same intent", async () => {
  const item = {
    id: "item-1",
    userId: "user-1",
    accountId: account.id,
    nativeId: "reply-1",
    nativePostId: "tweet-1",
    nativeUrl: "https://x.com/simplepost/status/1",
    body: "Question",
    createdAtNative: null,
    author: null,
    providerData: null,
    canReply: true,
    account,
  };
  prismaMock.socialActivityItem.findFirst.mockResolvedValue(item);
  prismaMock.socialActivityReply.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: "intent-1", activityItemId: item.id, body: "Thanks", status: "uncertain" });
  prismaMock.socialActivityReply.create.mockResolvedValue({
    id: "intent-1",
    activityItemId: item.id,
    body: "Thanks",
    status: "pending",
  });
  (replyToSocialComment as jest.Mock).mockResolvedValue({
    ok: false,
    error: { code: "uncertain", message: "Provider response was interrupted" },
  });

  await expect(
    sendSocialReply("user-1", { itemId: item.id, body: "Thanks", idempotencyKey: "safe-intent-key" }),
  ).rejects.toThrow("Provider response was interrupted");
  await expect(
    sendSocialReply("user-1", { itemId: item.id, body: "Thanks", idempotencyKey: "safe-intent-key" }),
  ).rejects.toThrow("already being sent");
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
  expect(prismaMock.socialActivityReply.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "uncertain" }) }),
  );
});

it("rejects unowned and concurrently claimed reply intents before a provider write", async () => {
  prismaMock.socialActivityItem.findFirst.mockResolvedValueOnce(null);
  await expect(
    sendSocialReply("user-1", { itemId: "foreign", body: "Thanks", idempotencyKey: "safe-intent-key" }),
  ).rejects.toThrow("not found");

  const item = {
    id: "item-claim",
    userId: "user-1",
    accountId: account.id,
    nativeId: "reply-1",
    nativePostId: "tweet-1",
    nativeUrl: null,
    body: "Question",
    createdAtNative: null,
    author: null,
    providerData: null,
    canReply: true,
    account,
  };
  prismaMock.socialActivityItem.findFirst.mockResolvedValue(item);
  prismaMock.socialActivityReply.findUnique.mockResolvedValue({
    id: "intent-claim",
    activityItemId: item.id,
    body: "Thanks",
    status: "failed",
  });
  prismaMock.socialActivityReply.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    sendSocialReply("user-1", { itemId: item.id, body: "Thanks", idempotencyKey: "safe-intent-key" }),
  ).rejects.toThrow("changed while it was being retried");
  expect(replyToSocialComment).not.toHaveBeenCalled();
});
