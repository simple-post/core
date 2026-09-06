/* eslint-disable unicorn/no-await-expression-member -- Keep assertions next to their database operations. */
import { deleteFromStorage, post as sdkPost, PostErrorType } from "@simple-post/sdk";

import { assertCanCreatePost, lockUserForQuota } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { postToAccounts } from "@/lib/posting";
import { publishFingerprint, runDurablePublish } from "@/lib/posting/durable-publish";
import { reconcilePublish } from "@/lib/posting/reconciliation";
import { prisma } from "@/lib/prisma";
import { collectUnusedStorage } from "@/lib/utils/storage-lifecycle";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  deleteFromStorage: jest.fn(),
  post: jest.fn(),
}));

const userId = "review-user";
const media = [
  {
    id: "media",
    url: "https://media.example.com/uploads/review-user/shared.png",
    type: "image" as const,
    filename: "shared.png",
    size: 1,
  },
];
const identity = {
  postId: "post",
  accountId: "account",
  platform: "x",
  operation: "post" as const,
  segment: 0,
  fingerprint: publishFingerprint({ message: "hello" }),
};
const success = {
  accountId: "account",
  platform: "x",
  success: true,
  postId: "remote-root",
  platformData: { uri: "at://did:plc:test/app.bsky.feed.post/one", cid: "bafy-root" },
  extraData: { refreshedCredentials: { accessToken: "DO_NOT_STORE" } },
};

beforeEach(async () => {
  process.env.S3_STORAGE_BASE_URL = "https://media.example.com";
  delete process.env.SELF_HOSTED;
  jest.clearAllMocks();
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Review",
      email: "review@example.com",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.create({
    data: { id: "account", userId, platform: "x", platformAccountId: "remote", accessToken: "unused" },
  });
  jest.mocked(deleteFromStorage).mockResolvedValue(undefined);
});

afterAll(async () => {
  await prisma.$disconnect();
});

it("serializes concurrent alias/provider reservations and counts each account operation", async () => {
  const publish = jest.fn().mockResolvedValue(success);
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      runDurablePublish(
        { ...identity, postId: `post-${index}`, accountId: `account-${index}`, platform: index % 2 ? "twitter" : "x" },
        publish,
      ),
    ),
  );
  expect(results.filter((result) => result.success)).toHaveLength(15);
  expect(results.filter((result) => result.error === "LOCAL_RATE_LIMIT")).toHaveLength(9);
  expect(publish).toHaveBeenCalledTimes(15);
  expect(await prisma.publishAttempt.count()).toBe(15);
});

it("commits intent before I/O, blocks a concurrent duplicate and reuses a saved success", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const publish = jest.fn(async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return success;
  });
  const first = runDurablePublish(identity, publish);
  await ready;
  expect((await prisma.publishCheckpoint.findFirst())?.state).toBe("started");
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  release();
  await first;
  const replay = await runDurablePublish(identity, publish);
  expect(replay.postId).toBe("remote-root");
  expect(replay.extraData).toEqual({ platformData: success.platformData });
  expect(JSON.stringify(await prisma.publishCheckpoint.findFirst())).not.toContain("DO_NOT_STORE");
  expect(publish).toHaveBeenCalledTimes(1);
  expect(await prisma.publishAttempt.count()).toBe(1);
});

it("blocks changed content and transport ambiguity without consuming another operation", async () => {
  const publish = jest.fn().mockRejectedValue(new Error("connection lost after acceptance"));
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect((await runDurablePublish({ ...identity, fingerprint: "changed" }, publish)).error).toBe(
    "PUBLISH_CONTENT_CHANGED",
  );
  expect(publish).toHaveBeenCalledTimes(1);
});

it.each(["INVALID_CONTENT", "CREDENTIALS_ERROR", "RATE_LIMIT_ERROR"])(
  "resumes after a conclusive %s rejection without repeating the root",
  async (error) => {
    const publish = jest.fn().mockResolvedValue(success);
    await runDurablePublish(identity, publish);
    const reply = { ...identity, segment: 1, fingerprint: "reply" };
    const rejection = await runDurablePublish(reply, async () => ({ ...success, success: false, error }));
    expect(rejection.error).toBe(error);
    expect((await prisma.publishCheckpoint.findFirst({ where: { segment: 1 } }))?.state).toBe("failed");
    await runDurablePublish(identity, publish);
    await runDurablePublish(reply, publish);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(await prisma.publishAttempt.count()).toBe(3);
  },
);

it.each(["root", "thread", "override", "thumbnail"])(
  "retains shared %s references and blocks saves once deletion is claimed",
  async (reference) => {
    const repository = new PostsModel(userId);
    const first = await repository.createPost(
      { message: "Original", status: "draft", scheduledFor: null, media, accountIds: ["account"] },
      userId,
    );
    const content =
      reference === "root"
        ? { media }
        : reference === "thread"
          ? { thread: [{ message: "reply", media }] }
          : reference === "override"
            ? { accountOverrides: { account: { thread: [{ message: "reply", media }] } } }
            : { accountOptions: { account: { thumbnailUrl: media[0].url } } };
    const duplicate = await repository.createPost(
      { message: "Duplicate", status: "draft", scheduledFor: null, media: [], accountIds: ["account"], ...content },
      userId,
    );
    await repository.deletePost(first.id);
    await prisma.storageDeletion.updateMany({ data: { dueAt: new Date(0) } });
    await collectUnusedStorage();
    expect(deleteFromStorage).not.toHaveBeenCalled();
    await repository.deletePost(duplicate.id);
    await prisma.storageDeletion.updateMany({ data: { dueAt: new Date(0) } });
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    jest.mocked(deleteFromStorage).mockImplementation(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const sweep = collectUnusedStorage();
    await ready;
    await expect(
      repository.createPost(
        { message: "Racing duplicate", status: "draft", scheduledFor: null, media, accountIds: ["account"] },
        userId,
      ),
    ).rejects.toThrow("media has expired");
    release();
    await sweep;
    expect(deleteFromStorage).toHaveBeenCalledTimes(1);
    expect((await prisma.storageDeletion.findFirst())?.state).toBe("deleted");
  },
);

it("charges only one of two concurrent draft promotions for the final trial slot", async () => {
  const repository = new PostsModel(userId);
  for (let i = 0; i < 9; i++)
    await repository.createPost(
      { message: "Paid allowance", status: "scheduled", scheduledFor: new Date(), media: [], accountIds: ["account"] },
      userId,
    );
  const drafts = await Promise.all(
    ["one", "two"].map((message) =>
      repository.createPost(
        { message, status: "draft", scheduledFor: null, media: [], accountIds: ["account"] },
        userId,
      ),
    ),
  );
  const snapshots = await Promise.all(drafts.map((draft) => repository.getPostById(draft.id)));
  const promote = (index: number) =>
    prisma.$transaction(async (tx) => {
      await lockUserForQuota(tx, userId);
      await assertCanCreatePost(userId, tx, { socialAccounts: [{ platform: "x" }], isExistingPostUpdate: false });
      return repository.updatePost(
        drafts[index].id,
        { status: "scheduled", scheduledFor: new Date() },
        { status: snapshots[index]!.status, updatedAt: snapshots[index]!.updatedAt },
        tx,
      );
    });
  const results = await Promise.allSettled([promote(0), promote(1)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await prisma.post.count({ where: { status: "scheduled" } })).toBe(10);
  expect(await prisma.post.count({ where: { status: "draft" } })).toBe(1);
});

jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
}));

it.each(["x", "bluesky"] as const)(
  "resumes the actual %s posting pipeline with the saved parent and root",
  async (platform) => {
    await prisma.connectedAccount.update({ where: { id: "account" }, data: { platform } });
    jest
      .mocked(sdkPost)
      .mockResolvedValueOnce(
        new Map([
          [platform, { error: PostErrorType.NO_ERROR, id: "root", extraData: { platformData: success.platformData } }],
        ]),
      )
      .mockResolvedValueOnce(new Map([[platform, { error: PostErrorType.INVALID_CONTENT, message: "Fix validation" }]]))
      .mockResolvedValueOnce(
        new Map([
          [
            platform,
            {
              error: PostErrorType.NO_ERROR,
              id: "reply",
              extraData: { platformData: { uri: "at://reply", cid: "reply-cid" } },
            },
          ],
        ]),
      );
    const run = () =>
      postToAccounts(
        userId,
        "Root",
        [],
        ["account"],
        undefined,
        undefined,
        [{ message: "Reply", media: [] }],
        undefined,
        undefined,
        { postId: "thread-post", source: "api" },
      );
    const first = await run();
    expect(first[0].success).toBe(false);
    const retry = await run();
    expect(retry[0].success).toBe(true);
    expect(retry[0].threadResults?.map((result) => result.postId)).toEqual(["root", "reply"]);
    expect(sdkPost).toHaveBeenCalledTimes(3);
    const options = jest.mocked(sdkPost).mock.calls[2][0].options;
    if (platform === "x") expect(options?.x?.replyToId).toBe("root");
    else expect(options?.bluesky?.replyTo).toEqual({ root: success.platformData, parent: success.platformData });
  },
);

it("requires ownership, a settled post and a current version to reconcile ambiguity", async () => {
  const repository = new PostsModel(userId);
  const post = await repository.createPost(
    { message: "uncertain", media: [], accountIds: ["account"], status: "failed", scheduledFor: new Date() },
    userId,
  );
  const inputIdentity = { ...identity, postId: post.id };
  await runDurablePublish(inputIdentity, async () => {
    throw new Error("lost response");
  });
  const checkpoint = (await prisma.publishCheckpoint.findFirst())!;
  const confirmation = {
    accountId: "account",
    operation: "post" as const,
    segment: 0,
    updatedAt: checkpoint.updatedAt.toISOString(),
    outcome: "not_published" as const,
    confirmed: true as const,
  };
  await expect(reconcilePublish("other-user", post.id, confirmation)).rejects.toThrow("Post not found");
  await prisma.post.update({ where: { id: post.id }, data: { status: "pending" } });
  await expect(reconcilePublish(userId, post.id, confirmation)).rejects.toThrow("Wait for publishing");
  await prisma.post.update({ where: { id: post.id }, data: { status: "failed" } });
  await expect(
    reconcilePublish(userId, post.id, { ...confirmation, updatedAt: new Date(0).toISOString() }),
  ).rejects.toThrow("changed");
  await reconcilePublish(userId, post.id, confirmation);
  const publish = jest.fn().mockResolvedValue(success);
  expect((await runDurablePublish(inputIdentity, publish)).success).toBe(true);
  expect(publish).toHaveBeenCalledTimes(1);
  await expect(reconcilePublish(userId, post.id, confirmation)).rejects.toThrow("changed");
});

it("rejects stale edits even when an intervening update reuses the same millisecond", async () => {
  const repository = new PostsModel(userId);
  const post = await repository.createPost(
    { message: "original", status: "scheduled", scheduledFor: new Date(), media: [], accountIds: ["account"] },
    userId,
  );
  const original = (await repository.getPostById(post.id))!;
  await prisma.post.update({ where: { id: post.id }, data: { message: "new", updatedAt: original.updatedAt } });
  await expect(
    repository.updatePost(post.id, { message: "stale" }, { status: original.status, updatedAt: original.updatedAt }),
  ).rejects.toThrow("changed");
  expect((await repository.getPostById(post.id))?.message).toBe("new");
});

it("records a preparation failure without consuming rate capacity and permits corrected content", async () => {
  const publish = jest.fn().mockResolvedValue(success);
  const prepare = jest.fn().mockRejectedValue(new Error("download failed"));
  expect((await runDurablePublish(identity, publish, prepare)).error).toBe("PREPARATION_ERROR");
  expect(publish).not.toHaveBeenCalled();
  expect(await prisma.publishAttempt.count()).toBe(0);
  expect((await runDurablePublish({ ...identity, fingerprint: "reuploaded-media" }, publish)).success).toBe(true);
  expect(await prisma.publishAttempt.count()).toBe(1);
});
