import { NextRequest } from "next/server";

import { post as sdkPost, PostErrorType } from "@simple-post/sdk";

import { GET as getProgress, POST as reconcile } from "@/app/api/v1/posts/[id]/reconcile/route";
import { PATCH as retry } from "@/app/api/v1/posts/[id]/route";
import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { postToAccounts } from "@/lib/posting";
import { runDurablePublish } from "@/lib/posting/durable-publish";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

import type { Prisma } from "@prisma/client";

jest.mock("@simple-post/sdk", () => ({ ...jest.requireActual("@simple-post/sdk"), post: jest.fn() }));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  ...jest.requireActual("@/lib/security/connected-account-secrets"),
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
  getCredentialIssuesForPublishTime: async () => [],
}));
jest.mock("@/lib/webhooks", () => ({ dispatchPostWebhooks: jest.fn() }));

const userId = "api-review-user";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(id: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/posts/${id}${method === "PATCH" ? "" : "/reconcile"}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  jest.resetAllMocks();
  delete process.env.SELF_HOSTED;
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Test",
      email: "api-review@example.com",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.create({
    data: { id: "account", userId, platform: "x", platformAccountId: "test", accessToken: "unused" },
  });
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function failedPost() {
  return new PostsModel(userId).createPost(
    {
      message: "Root",
      media: [],
      accountIds: ["account"],
      status: "failed",
      scheduledFor: new Date(),
      thread: [{ message: "Reply" }],
    },
    userId,
  );
}

it("PATCH retries the saved thread ID and publishes only the missing reply", async () => {
  const post = await failedPost();
  jest
    .mocked(sdkPost)
    .mockResolvedValueOnce(new Map([["x", { id: "root", error: PostErrorType.NO_ERROR }]]))
    .mockResolvedValueOnce(new Map([["x", { error: PostErrorType.INVALID_CONTENT, message: "Validation failed" }]]))
    .mockResolvedValueOnce(new Map([["x", { id: "reply", error: PostErrorType.NO_ERROR }]]));
  const first = await postToAccounts(
    userId,
    "Root",
    [],
    ["account"],
    undefined,
    undefined,
    [{ message: "Reply" }],
    undefined,
    undefined,
    { postId: post.id, source: "api" },
  );
  expect(first[0].success).toBe(false);
  // Persist the partial response exactly as the first HTTP attempt does.
  await prisma.post.update({
    where: { id: post.id },
    data: {
      accountResults: sanitizeForJson({ account: first[0] }) as Prisma.InputJsonValue,
      threadResults: sanitizeForJson({ account: first[0].threadResults }) as Prisma.InputJsonValue,
    },
  });
  const response = await retry(
    request(post.id, "PATCH", {
      message: "Root",
      media: [],
      accountIds: ["account"],
      thread: [{ message: "Reply" }],
      postingMode: "now",
    }),
    context(post.id),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.post.id).toBe(post.id);
  expect(body.post.status).toBe("published");
  expect(jest.mocked(sdkPost).mock.calls.map(([input]) => input.content.text)).toEqual(["Root", "Reply", "Reply"]);
  expect(jest.mocked(sdkPost).mock.calls[2][0].options?.x?.replyToId).toBe("root");
  const progress = await getProgress(request(post.id, "GET"), context(post.id));
  expect(progress.status).toBe(200);
  const saved = await progress.json();
  expect(
    saved.checkpoints.map((c: { state: string; result: { postId: string } }) => [c.state, c.result.postId]),
  ).toEqual([
    ["succeeded", "root"],
    ["succeeded", "reply"],
  ]);
  const again = await retry(
    request(post.id, "PATCH", {
      message: "Root",
      media: [],
      accountIds: ["account"],
      postingMode: "now",
    }),
    context(post.id),
  );
  expect(again.status).toBe(400);
  expect(sdkPost).toHaveBeenCalledTimes(3);
});

it.each(["extra-account", "legacy-unknown"])("PATCH rejects %s retries before platform I/O", async (kind) => {
  const post = await failedPost();
  const response = await retry(
    request(post.id, "PATCH", {
      message: "Root",
      media: [],
      accountIds: kind === "extra-account" ? ["account", "new-account"] : ["account"],
      postingMode: "now",
    }),
    context(post.id),
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    kind === "extra-account" ? "cannot add accounts" : "no durable publishing record",
  );
  expect(sdkPost).not.toHaveBeenCalled();
});

it("HTTP reconciliation enforces owner, explicit confirmation, and current version without publishing", async () => {
  const post = await failedPost();
  await runDurablePublish(
    { postId: post.id, accountId: "account", platform: "x", operation: "post", segment: 0, fingerprint: "uncertain" },
    async () => {
      throw new Error("lost response");
    },
  );
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: "other-user" } } as never);
  const forbidden = await getProgress(request(post.id, "GET"), context(post.id));
  expect(forbidden.status).toBe(404);
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
  const response = await getProgress(request(post.id, "GET"), context(post.id));
  const { checkpoints } = await response.json();
  const input = {
    accountId: "account",
    operation: "post",
    segment: 0,
    updatedAt: checkpoints[0].updatedAt,
    confirmed: true,
    outcome: "published",
    platformPostId: "observed-root",
    postUrl: "https://x.com/test/status/123",
  };
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: "other-user" } } as never);
  const forbiddenWrite = await reconcile(request(post.id, "POST", input), context(post.id));
  expect(forbiddenWrite.status).toBe(404);
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
  const unconfirmed = await reconcile(request(post.id, "POST", { ...input, confirmed: false }), context(post.id));
  expect(unconfirmed.status).toBe(400);
  const stale = await reconcile(
    request(post.id, "POST", { ...input, updatedAt: new Date(0).toISOString() }),
    context(post.id),
  );
  expect(stale.status).toBe(409);
  const accepted = await reconcile(request(post.id, "POST", input), context(post.id));
  expect(accepted.status).toBe(200);
  const repeated = await reconcile(request(post.id, "POST", input), context(post.id));
  expect(repeated.status).toBe(409);
  expect(sdkPost).not.toHaveBeenCalled();
  expect(await prisma.publishAttempt.count()).toBe(1);
});
