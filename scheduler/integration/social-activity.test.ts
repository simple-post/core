import { likeSocialItem, listSocialPostComments, listSocialPostQuotes, replyToSocialComment } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { getSocialInbox, refreshSocialInbox, sendSocialLike, sendSocialReply } from "@/lib/social/activity";

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
