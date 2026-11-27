import { likeSocialItem, listSocialPostComments, listSocialPostQuotes, replyToSocialComment } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import {
  getSocialInbox,
  refreshSocialInbox,
  runBackgroundInboxRefresh,
  sendSocialLike,
  sendSocialReply,
} from "@/lib/social/activity";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  likeSocialItem: jest.fn(),
  listSocialPostComments: jest.fn(),
  listSocialPostQuotes: jest.fn(),
  replyToSocialComment: jest.fn(),
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
}));

const userId = "social-review-owner";
const otherUserId = "social-review-other";
const postId = "social-review-post";
const accountId = "social-review-account";
const itemId = "social-review-item";
const userIds = [userId, otherUserId];
const input = { itemId, body: "Local fixture reply", idempotencyKey: "social-review-reply-key" };

beforeEach(async () => {
  jest.resetAllMocks();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.user.createMany({
    data: userIds.map((id) => ({ id, email: `${id}@example.invalid`, name: "Local review" })),
  });
  await prisma.userFeature.create({ data: { userId, feature: "SOCIAL_INBOX" } });
  await prisma.connectedAccount.create({
    data: {
      id: accountId,
      userId,
      platform: "x",
      platformAccountId: "101",
      scope: "like.write",
      ...encryptConnectedAccountSecrets({ accessToken: "local-fixture-token" }),
    },
  });
  await prisma.post.create({
    data: {
      id: postId,
      userId,
      status: "failed",
      message: "Local fixture",
      publishedAt: new Date(),
      accounts: { connect: { id: accountId } },
      accountResults: { [accountId]: { accountId, success: true, postId: "500" } },
    },
  });
  await prisma.socialActivityItem.create({
    data: {
      id: itemId,
      userId,
      accountId,
      postId,
      platform: "x",
      kind: "comment",
      nativeId: "501",
      nativePostId: "500",
      body: "Local cached comment",
      canReply: true,
      canLike: true,
      eventAt: new Date(),
    },
  });
  jest.mocked(replyToSocialComment).mockResolvedValue({
    ok: true,
    data: { nativeId: "502", createdAt: new Date().toISOString() },
  });
  jest.mocked(likeSocialItem).mockResolvedValue({ ok: true, data: { liked: true } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

it("requires a live grant and rejects another user's item before making provider calls", async () => {
  await expect(getSocialInbox(otherUserId)).rejects.toThrow("Social inbox is not enabled");
  await expect(refreshSocialInbox(otherUserId)).rejects.toThrow("Social inbox is not enabled");
  await prisma.userFeature.create({ data: { userId: otherUserId, feature: "SOCIAL_INBOX" } });
  const otherInbox = await getSocialInbox(otherUserId);
  expect(otherInbox.items).toEqual([]);
  await expect(sendSocialReply(otherUserId, input)).rejects.toThrow("Social inbox item not found");
  await expect(sendSocialLike(otherUserId, itemId)).rejects.toThrow("Social inbox item not found");
  await prisma.userFeature.deleteMany({ where: { userId } });
  await expect(sendSocialReply(userId, input)).rejects.toThrow("Social inbox is not enabled");
  expect(listSocialPostComments).not.toHaveBeenCalled();
  expect(replyToSocialComment).not.toHaveBeenCalled();
  expect(likeSocialItem).not.toHaveBeenCalled();
});

it("deduplicates concurrent writes and removes a confirmed reply from Needs reply", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => sendSocialReply(userId, input)));
  expect(results.some((result) => result.status === "sent")).toBe(true);
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
  expect(await sendSocialReply(userId, input)).toMatchObject({ status: "sent" });
  await expect(sendSocialReply(userId, { ...input, body: "Different reply" })).rejects.toThrow(
    "belongs to a different reply",
  );
  await Promise.all(Array.from({ length: 6 }, () => sendSocialLike(userId, itemId)));
  expect(likeSocialItem).toHaveBeenCalledTimes(1);
  const awaiting = await getSocialInbox(userId, { needsReply: true });
  const inbox = await getSocialInbox(userId);
  expect(awaiting.items).toEqual([]);
  expect(inbox.items[0]).toMatchObject({ liked: true, reply: { status: "sent" } });
});

it("keeps an uncertain receipt and blocks a different key while delivery is unresolved", async () => {
  jest.mocked(replyToSocialComment).mockResolvedValue({
    ok: false,
    error: { code: "uncertain", message: "Local fixture ambiguous delivery" },
  });
  await expect(sendSocialReply(userId, input)).resolves.toMatchObject({ status: "uncertain" });
  await expect(sendSocialReply(userId, input)).resolves.toMatchObject({ status: "uncertain" });
  await expect(sendSocialReply(userId, { ...input, idempotencyKey: "different-intent-key" })).rejects.toThrow(
    "already pending",
  );
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
});

it("advances reply and quote cursors on successful destinations, excluding self activity", async () => {
  const makeItem = (nativeId: string, authorId: string, createdAt: string) => ({
    nativeId,
    nativePostId: "500",
    body: nativeId,
    author: { id: authorId },
    canReply: true,
    createdAt,
  });
  jest
    .mocked(listSocialPostComments)
    .mockResolvedValueOnce({
      ok: true,
      data: {
        data: [makeItem("503", "999", "2026-11-01T00:00:00.000Z"), makeItem("504", "101", "2026-11-01T00:00:00.000Z")],
        nextCursor: "next-page",
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { data: [{ ...makeItem("503", "999", "2026-11-01T00:00:00.000Z"), kind: "quote" }] },
    });
  jest.mocked(listSocialPostQuotes).mockResolvedValue({
    ok: true,
    data: { data: [makeItem("505", "999", "2026-11-02T00:00:00.000Z")] },
  });
  await refreshSocialInbox(userId, { reset: true });
  expect(listSocialPostComments).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ accountId }),
    expect.objectContaining({ nativePostId: "500" }),
    expect.objectContaining({ cursor: "next-page" }),
  );
  const first = await getSocialInbox(userId, { platform: "x", limit: 2 });
  expect(first.items.map((item) => item.body)).toEqual(["Local cached comment", "505"]);
  expect(first.items[1]).toMatchObject({ kind: "quote" });
  const second = await getSocialInbox(userId, { platform: "x", cursor: first.nextCursor });
  expect(second.items).toMatchObject([{ body: "503", kind: "quote" }]);
  const bluesky = await getSocialInbox(userId, { platform: "bluesky" });
  expect(bluesky.items).toEqual([]);
});

it("cascades inbox cache, cursors, and receipts when the account is disconnected", async () => {
  await sendSocialReply(userId, input);
  await prisma.socialActivitySync.create({ data: { accountId } });
  await prisma.connectedAccount.delete({ where: { id: accountId } });
  expect(await prisma.socialActivityItem.count({ where: { userId } })).toBe(0);
  expect(await prisma.socialActivityReply.count({ where: { userId } })).toBe(0);
  expect(await prisma.socialActivitySync.count({ where: { accountId } })).toBe(0);
});

it("recognizes a like and direct reply made on X, and clears the like after a complete read", async () => {
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { scope: "like.read like.write" } });
  jest.mocked(listSocialPostComments).mockResolvedValue({
    ok: true,
    data: {
      data: [
        { nativeId: "501", nativePostId: "500", body: "A question", canReply: true, canLike: true },
        {
          nativeId: "502",
          nativePostId: "500",
          parentNativeId: "501",
          author: { id: "101" },
          body: "Answered on X",
          nativeUrl: "https://x.com/i/web/status/502",
          canReply: true,
        },
      ],
    },
  });
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });
  const provider = jest.spyOn(globalThis, "fetch");
  try {
    provider.mockResolvedValueOnce(Response.json({ data: [{ id: "501" }], meta: { result_count: 1 } }));
    await refreshSocialInbox(userId, { reset: true });
    expect(provider).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error" }));
    const inbox = await getSocialInbox(userId);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      liked: true,
      reply: { status: "sent", body: "Answered on X", nativeReplyUrl: "https://x.com/i/web/status/502" },
    });
    const unanswered = await getSocialInbox(userId, { needsReply: true });
    expect(unanswered.items).toEqual([]);
    provider.mockResolvedValueOnce(Response.json({ meta: { result_count: 0 } }));
    await refreshSocialInbox(userId, { reset: true });
    const refreshed = await getSocialInbox(userId);
    expect(refreshed.items[0]).toMatchObject({ liked: false, reply: { status: "sent" } });
  } finally {
    provider.mockRestore();
  }
});

it("resumes automatic reads without disturbing manual pagination or prompting reconnection for a restricted edge", async () => {
  jest.mocked(listSocialPostComments).mockImplementation(async (_, __, { cursor } = {}) => ({
    ok: true,
    data: { data: [], nextCursor: cursor ? `${cursor}-next` : "manual-page" },
  }));
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });
  await refreshSocialInbox(userId, { reset: true });
  await prisma.socialActivitySync.update({ where: { accountId }, data: { lastAttemptAt: new Date(0) } });

  jest
    .mocked(listSocialPostComments)
    .mockReset()
    .mockImplementation(async (_, __, { cursor } = {}) => ({
      ok: true,
      data: { data: [], nextCursor: cursor ? String(Number(cursor) + 1) : "1" },
    }));
  await refreshSocialInbox(userId, { automatic: true });
  await prisma.socialActivitySync.update({ where: { accountId }, data: { lastAttemptAt: new Date(0) } });
  jest.mocked(listSocialPostComments).mockResolvedValueOnce({
    ok: false,
    error: { code: "permission_required", message: "This post is restricted" },
  });
  await refreshSocialInbox(userId, { automatic: true });

  expect(listSocialPostComments).toHaveBeenNthCalledWith(4, expect.anything(), expect.anything(), {
    cursor: "3",
    limit: 10,
  });
  expect(listSocialPostQuotes).toHaveBeenCalled();
  const stored = await prisma.socialActivitySync.findUniqueOrThrow({ where: { accountId } });
  expect(stored).toMatchObject({ providerCursor: "manual-page-next-next", targetIndex: 0, phase: "comments" });
  const inbox = await getSocialInbox(userId);
  expect(inbox.accounts[0]).toMatchObject({ hasMore: true });
  expect(inbox.accounts[0].permissionUrl).toBeUndefined();
  expect(inbox.accounts[0].error).toBeUndefined();
});

it("reads the newest Bluesky roots first, then resumes paginated quotes and thread segments", async () => {
  const blueskyId = "social-review-bluesky";
  await prisma.connectedAccount.create({
    data: {
      id: blueskyId,
      userId,
      platform: "bluesky",
      platformAccountId: "did:plc:owner",
      ...encryptConnectedAccountSecrets({ accessToken: "local-fixture-token" }),
    },
  });
  const rootIds = [1, 2, 3, 4, 5].map((number) => `root-${number}`);
  for (const [index, rootId] of rootIds.entries()) {
    await prisma.post.create({
      data: {
        userId,
        message: rootId,
        status: "published",
        publishedAt: new Date(Date.now() - index * 60_000),
        accounts: { connect: { id: blueskyId } },
        accountResults: { [blueskyId]: { accountId: blueskyId, success: true, postId: rootId } },
        ...(index === 0 && {
          threadResults: {
            [blueskyId]: [1, 2, 3, 4].map((number) => ({ success: true, postId: `segment-${number}` })),
          },
        }),
      },
    });
  }
  const legacyTarget = { key: "legacy-segment", postId, nativePostId: "legacy-segment" };
  await prisma.socialActivitySync.create({
    data: {
      accountId: blueskyId,
      lastAttemptAt: new Date(0),
      targetSnapshot: {
        targets: [legacyTarget],
        recent: {
          snapshot: { targets: [legacyTarget] },
          index: 0,
          cursor: "old-automatic-page",
          phase: "quotes",
        },
      },
      providerCursor: "manual-page",
    },
  });

  const reads: Array<[string, string, string | undefined]> = [];
  jest.mocked(listSocialPostComments).mockImplementation(async (_, { nativePostId }, { cursor } = {}) => {
    reads.push(["comments", nativePostId, cursor]);
    return {
      ok: true,
      data: {
        data:
          nativePostId === "root-3"
            ? [{ nativeId: "bluesky-reply", nativePostId, body: "Reply on the third newest post", canReply: true }]
            : [],
      },
    };
  });
  jest.mocked(listSocialPostQuotes).mockImplementation(async (_, { nativePostId }, { cursor } = {}) => {
    reads.push(["quotes", nativePostId, cursor]);
    return {
      ok: true,
      data: { data: [], nextCursor: nativePostId === "root-1" && !cursor ? "quotes-page" : undefined },
    };
  });

  const refresh = () => refreshSocialInbox(userId, { automatic: true, platform: "bluesky" });
  await refresh();
  expect(reads).toEqual([
    ["comments", "root-1", undefined],
    ["comments", "root-2", undefined],
    ["comments", "root-3", undefined],
  ]);
  const inbox = await getSocialInbox(userId, { platform: "bluesky" });
  expect(inbox.items).toMatchObject([{ body: "Reply on the third newest post" }]);

  for (let tick = 0; tick < 4; tick += 1) {
    await prisma.socialActivitySync.update({
      where: { accountId: blueskyId },
      data: { lastAttemptAt: new Date(0) },
    });
    await refresh();
  }
  expect(reads.slice(3)).toEqual([
    ["comments", "root-4", undefined],
    ["comments", "root-5", undefined],
    ["quotes", "root-1", undefined],
    ["quotes", "root-1", "quotes-page"],
    ["quotes", "root-2", undefined],
    ["quotes", "root-3", undefined],
    ["quotes", "root-4", undefined],
    ["quotes", "root-5", undefined],
    ["comments", "segment-1", undefined],
    ["quotes", "segment-1", undefined],
    ["comments", "segment-2", undefined],
    ["quotes", "segment-2", undefined],
  ]);
  const stored = await prisma.socialActivitySync.findUniqueOrThrow({ where: { accountId: blueskyId } });
  expect(stored).toMatchObject({
    targetSnapshot: { targets: [legacyTarget] },
    providerCursor: "manual-page",
    targetIndex: 0,
    phase: "comments",
  });
});

it("reports provider restrictions and missing X like permissions alongside a connection with no tracked posts", async () => {
  await prisma.connectedAccount.createMany({
    data: [
      {
        id: "social-review-threads",
        userId,
        platform: "threads",
        platformAccountId: "208",
        accessToken: "local-fixture-token",
        scope: "threads_read_replies",
      },
      {
        id: "social-review-instagram",
        userId,
        platform: "instagram",
        platformAccountId: "209",
        accessToken: "local-fixture-token",
        scope: "instagram_business_manage_comments",
      },
    ],
  });
  await prisma.post.create({
    data: {
      userId,
      message: "Threads fixture",
      status: "published",
      publishedAt: new Date(),
      accounts: { connect: { id: "social-review-threads" } },
      accountResults: { "social-review-threads": { accountId: "social-review-threads", success: true, postId: "601" } },
    },
  });
  jest.mocked(listSocialPostComments).mockImplementation(async ({ platform }) =>
    platform === "threads"
      ? {
          ok: false,
          error: {
            code: "app_permission_required",
            message: "Meta is blocking Inbox access for SimplePost at the app level.",
          },
        }
      : { ok: true, data: { data: [] } },
  );
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });

  await refreshSocialInbox(userId, { automatic: true });
  const { accounts } = await getSocialInbox(userId);
  expect(accounts.find(({ platform }) => platform === "threads")).toMatchObject({
    error: expect.stringContaining("app level"),
    permissionUrl: undefined,
  });
  expect(accounts.find(({ platform }) => platform === "x")).toMatchObject({ needsLikePermission: true });
  expect(accounts.find(({ platform }) => platform === "instagram")).toMatchObject({
    noTrackedPosts: true,
    lastCheckedAt: expect.any(String),
  });
});

it("finds a native X like on the second page during a focused manual refresh", async () => {
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { scope: "like.read like.write" } });
  jest.mocked(listSocialPostComments).mockResolvedValue({ ok: true, data: { data: [] } });
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });
  const provider = jest.spyOn(globalThis, "fetch");
  try {
    provider
      .mockResolvedValueOnce(Response.json({ data: [{ id: "600" }], meta: { result_count: 1, next_token: "older" } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "501" }], meta: { result_count: 1 } }));
    await refreshSocialInbox(userId, { reset: true, platforms: ["x"] });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(new URL(String(provider.mock.calls[1][0])).searchParams.get("pagination_token")).toBe("older");
    const inbox = await getSocialInbox(userId);
    expect(inbox.items[0]).toMatchObject({ liked: true });
  } finally {
    provider.mockRestore();
  }
});

it("syncs due personal and team accounts with no browser and claims them once across overlapping runs", async () => {
  await prisma.userFeature.create({ data: { userId, feature: "TEAM_WORKSPACES" } });
  const workspace = await prisma.teamWorkspace.create({
    data: {
      creatorId: userId,
      name: "Inbox team",
      icon: "team",
      description: "",
      members: { create: { userId, role: "Admin", approver: true } },
    },
  });
  const accounts = [
    { id: "background-bluesky", userId, workspaceId: null, platform: "bluesky" },
    { id: "background-youtube", userId, workspaceId: workspace.id, platform: "youtube" },
    { id: "background-no-grant", userId: otherUserId, workspaceId: null, platform: "bluesky" },
    { id: "background-unsupported", userId, workspaceId: null, platform: "tiktok" },
    { id: "background-backoff", userId, workspaceId: null, platform: "youtube" },
  ];
  for (const account of accounts) {
    await prisma.connectedAccount.create({
      data: { ...account, platformAccountId: account.id, accessToken: "local-fixture-token" },
    });
    await prisma.post.create({
      data: {
        userId: account.userId,
        status: "published",
        message: account.id,
        publishedAt: new Date(),
        accounts: { connect: { id: account.id } },
        accountResults: { [account.id]: { accountId: account.id, success: true, postId: account.id } },
      },
    });
  }
  await prisma.socialActivitySync.create({
    data: { accountId: "background-backoff", retryAt: new Date(Date.now() + 60_000) },
  });

  jest.mocked(listSocialPostComments).mockImplementation(async ({ accountId }, { nativePostId }) =>
    accountId === "background-bluesky" || accountId === "background-youtube"
      ? {
          ok: true,
          data: { data: [{ nativeId: `${nativePostId}-reply`, nativePostId, body: accountId, canReply: true }] },
        }
      : { ok: true, data: { data: [] } },
  );
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });
  await Promise.all([runBackgroundInboxRefresh(), runBackgroundInboxRefresh()]);
  const expected = ["background-bluesky", "background-youtube", accountId].sort();
  expect(
    jest
      .mocked(listSocialPostComments)
      .mock.calls.map(([account]) => account.accountId)
      .sort(),
  ).toEqual(expected);
  const personal = await getSocialInbox(userId, { platform: "bluesky" });
  const team = await getSocialInbox(userId, { workspaceId: workspace.id });
  expect(personal.items).toMatchObject([{ body: "background-bluesky" }]);
  expect(team.items).toMatchObject([{ body: "background-youtube" }]);
  await expect(runBackgroundInboxRefresh()).resolves.toMatchObject({ accounts: [] });
});

it("checks X on a slower schedule with small pages and applies the background pause switch", async () => {
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { scope: "like.read" } });
  jest.mocked(listSocialPostComments).mockResolvedValue({ ok: true, data: { data: [] } });
  jest.mocked(listSocialPostQuotes).mockResolvedValue({ ok: true, data: { data: [] } });
  const provider = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ data: [{ id: "501" }], meta: { result_count: 1 } }));
  const env = jest.replaceProperty(process, "env", {
    ...process.env,
    SOCIAL_INBOX_BACKGROUND_REFRESH: "true",
    SOCIAL_INBOX_BACKGROUND_X_INTERVAL_MINUTES: "360",
  });
  try {
    await runBackgroundInboxRefresh();
    expect(listSocialPostComments).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      cursor: undefined,
      limit: 10,
    });
    expect(listSocialPostQuotes).not.toHaveBeenCalled();
    const [url] = provider.mock.calls[0];
    expect(String(url)).toContain("max_results=10");
    const inbox = await getSocialInbox(userId);
    expect(inbox.items[0].liked).toBe(true);

    await prisma.socialActivitySync.update({
      where: { accountId },
      data: { lastAttemptAt: new Date(Date.now() - 10 * 60_000) },
    });
    await expect(runBackgroundInboxRefresh()).resolves.toMatchObject({ accounts: [] });
    await prisma.socialActivitySync.update({ where: { accountId }, data: { lastAttemptAt: new Date(0) } });
    process.env.SOCIAL_INBOX_BACKGROUND_X_INTERVAL_MINUTES = "0";
    await expect(runBackgroundInboxRefresh()).resolves.toMatchObject({ accounts: [] });
    process.env.SOCIAL_INBOX_BACKGROUND_X_INTERVAL_MINUTES = "360";
    process.env.SOCIAL_INBOX_BACKGROUND_REFRESH = "false";
    await expect(runBackgroundInboxRefresh()).resolves.toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(listSocialPostComments).toHaveBeenCalledTimes(1);
    expect(listSocialPostQuotes).not.toHaveBeenCalled();
  } finally {
    provider.mockRestore();
    env.restore();
  }
});
