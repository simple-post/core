import { replyToSocialComment } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { getSocialInbox, sendSocialReply } from "@/lib/social/activity";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  replyToSocialComment: jest.fn(),
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
}));
const userId = "social-review-user";
const otherUserId = "social-review-other";
const accountId = "social-review-account";
const itemId = "social-review-item";
const input = { itemId, body: "Local fixture reply", idempotencyKey: "social-review-reply-key" };

beforeEach(async () => {
  jest.clearAllMocks();
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.user.createMany({
    data: [userId, otherUserId].map((id) => ({
      id,
      email: `${id}@example.invalid`,
      name: "Local review",
      acquisition: JSON.stringify({ version: 1, source: "unknown" }),
    })),
  });
  await prisma.connectedAccount.create({
    data: encryptConnectedAccountSecrets({
      id: accountId,
      userId,
      platform: "x",
      platformAccountId: "social-review-native-account",
      accessToken: "local-fixture-token",
    }),
  });
  await prisma.post.create({
    data: { id: "social-review-post", userId, status: "published", message: "Local fixture", publishedAt: new Date() },
  });
  await prisma.socialActivityItem.create({
    data: {
      id: itemId,
      userId,
      accountId,
      postId: "social-review-post",
      platform: "x",
      kind: "comment",
      nativeId: "native-comment",
      nativePostId: "native-post",
      body: "Local cached comment",
      canReply: true,
    },
  });
  (replyToSocialComment as jest.Mock).mockResolvedValue({
    ok: true,
    data: { nativeId: "native-reply", createdAt: new Date().toISOString() },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

it("rejects another user's cached activity before any provider call", async () => {
  const inbox = await getSocialInbox(otherUserId);
  expect(inbox.items).toEqual([]);
  await expect(sendSocialReply(otherUserId, input)).rejects.toThrow("Social activity item not found");
  expect(replyToSocialComment).not.toHaveBeenCalled();
});

it("claims one durable reply intent under concurrent requests and replays its receipt", async () => {
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => sendSocialReply(userId, input)));
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
  expect(await prisma.socialActivityReply.count({ where: { userId } })).toBe(1);
  expect(await sendSocialReply(userId, input)).toMatchObject({ status: "sent" });
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
  await expect(sendSocialReply(userId, { ...input, body: "Different reply" })).rejects.toThrow(
    "This reply key belongs to a different reply",
  );
});

it("retains uncertain delivery and blocks retries after a network-ambiguous write", async () => {
  (replyToSocialComment as jest.Mock).mockResolvedValue({
    ok: false,
    error: { code: "uncertain", message: "Local fixture ambiguous delivery" },
  });
  await expect(sendSocialReply(userId, input)).rejects.toThrow("Local fixture ambiguous delivery");
  const reply = await prisma.socialActivityReply.findUniqueOrThrow({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
  });
  expect(reply.status).toBe("uncertain");
  await expect(sendSocialReply(userId, input)).rejects.toThrow("Check the platform");
  expect(replyToSocialComment).toHaveBeenCalledTimes(1);
});

it("cascades social cache on account deletion while retaining shared activation history", async () => {
  await sendSocialReply(userId, input);
  await prisma.socialPostMetric.create({
    data: { userId, accountId, postId: "social-review-post", platform: "x", nativePostId: "native-post" },
  });
  await prisma.socialActivitySync.create({ data: { accountId } });
  await prisma.connectedAccount.delete({ where: { id: accountId } });
  expect(await prisma.socialActivityItem.count({ where: { userId } })).toBe(0);
  expect(await prisma.socialActivityReply.count({ where: { userId } })).toBe(0);
  expect(await prisma.socialPostMetric.count({ where: { userId } })).toBe(0);
  expect(await prisma.socialActivitySync.count({ where: { accountId } })).toBe(0);
  const milestone = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId } });
  expect(milestone.socialConnectedAt).not.toBeNull();
  expect(milestone.firstPostPublishedAt).not.toBeNull();
});
