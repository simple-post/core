import { NextRequest } from "next/server";

import { DELETE as disconnectAccount } from "@/app/api/v1/accounts/[id]/route";
import { GET as listAccounts } from "@/app/api/v1/accounts/route";
import { GET as getPost, PATCH as editPost, DELETE as deletePost } from "@/app/api/v1/posts/[id]/route";
import { GET as calendar } from "@/app/api/v1/posts/calendar/route";
import { GET as listPosts, POST as createPost } from "@/app/api/v1/posts/route";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

const owner = "expired-trial-read-review";
const other = "expired-trial-other-review";
jest.mock("@/lib/auth/auth", () => ({
  auth: {
    api: { getSession: async () => ({ user: { id: "expired-trial-read-review" }, session: { id: "review-session" } }) },
  },
}));

let postId: string;
let otherPostId: string;
let accountId: string;
beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await prisma.user.createMany({
    data: [owner, other].map((id) => ({ id, name: "Read access review", email: `${id}@example.invalid` })),
  });
  await prisma.freeTrial.create({
    data: { userId: owner, startsAt: new Date("2026-01-01"), expiresAt: new Date("2026-01-08") },
  });
  const account = await prisma.connectedAccount.create({
    data: encryptConnectedAccountSecrets({
      userId: owner,
      platform: "linkedin",
      platformAccountId: "review-account",
      username: "Review account",
      accessToken: "test-only-provider-token",
    }),
  });
  accountId = account.id;
  const post = await prisma.post.create({
    data: {
      userId: owner,
      status: "draft",
      message: "My saved draft",
      scheduledFor: null,
      accounts: { connect: { id: account.id } },
    },
  });
  postId = post.id;
  const otherPost = await prisma.post.create({
    data: { userId: other, status: "draft", message: "Other user's private draft", scheduledFor: null },
  });
  otherPostId = otherPost.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
});

async function statusOf(response: Promise<Response>) {
  const result = await response;
  return result.status;
}

function request(path: string, method = "GET") {
  return new NextRequest(`https://example.test${path}`, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    ...(method === "POST" || method === "PATCH"
      ? {
          body: JSON.stringify({
            message: "Must not be saved",
            accountIds: [accountId],
            postingMode: "draft",
            media: [],
          }),
        }
      : {}),
  });
}

it("returns the owner's saved posts and accounts after expiry without leaking provider secrets", async () => {
  const posts = await listPosts(request("/api/v1/posts?type=drafts"));
  expect(posts.status).toBe(200);
  expect(JSON.stringify(await posts.json())).toContain("My saved draft");
  const accounts = await listAccounts(request("/api/v1/accounts"));
  expect(accounts.status).toBe(200);
  const body = JSON.stringify(await accounts.json());
  expect(body).toContain("Review account");
  expect(body).not.toContain("test-only-provider-token");
  expect(body).not.toContain("accessToken");
  expect(await statusOf(getPost(request(`/api/v1/posts/${postId}`), { params: Promise.resolve({ id: postId }) }))).toBe(
    200,
  );
  expect(
    await statusOf(calendar(request("/api/v1/posts/calendar?from=2026-01-01T00:00:00Z&to=2026-01-08T00:00:00Z"))),
  ).toBe(200);
});

it("keeps saved data scoped to the authenticated owner", async () => {
  const response = await getPost(request(`/api/v1/posts/${otherPostId}`), {
    params: Promise.resolve({ id: otherPostId }),
  });
  expect(response.status).toBe(404);
  expect(JSON.stringify(await response.json())).not.toContain("Other user's private draft");
});

it("rejects creation, editing, deletion and disconnection without changing saved work", async () => {
  expect(await statusOf(createPost(request("/api/v1/posts", "POST")))).toBe(402);
  expect(
    await statusOf(editPost(request(`/api/v1/posts/${postId}`, "PATCH"), { params: Promise.resolve({ id: postId }) })),
  ).toBe(402);
  expect(
    await statusOf(
      deletePost(request(`/api/v1/posts/${postId}`, "DELETE"), { params: Promise.resolve({ id: postId }) }),
    ),
  ).toBe(402);
  expect(
    await statusOf(
      disconnectAccount(request(`/api/v1/accounts/${accountId}`, "DELETE"), {
        params: Promise.resolve({ id: accountId }),
      }),
    ),
  ).toBe(402);
  expect(await prisma.post.count({ where: { userId: owner } })).toBe(1);
  const saved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  expect(saved.message).toBe("My saved draft");
  expect(await prisma.connectedAccount.count({ where: { userId: owner } })).toBe(1);
});
