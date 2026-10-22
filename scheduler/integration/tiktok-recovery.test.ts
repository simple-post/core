/* eslint-disable unicorn/no-await-expression-member -- Keep database assertions adjacent to their awaited operations. */
import { PostErrorType } from "@simple-post/sdk";

import type { PostingResult } from "@/lib/posting";
import { runDurablePublish } from "@/lib/posting/durable-publish";
import type { DurablePublishContext } from "@/lib/posting/recovery";
import { prisma } from "@/lib/prisma";

const identity = {
  postId: "recovery-post",
  accountId: "recovery-account",
  platform: "tiktok",
  operation: "post" as const,
  segment: 0,
  fingerprint: "original-video",
  recoveryProvider: "tiktok-video" as const,
};
const key = {
  postId_accountId_operation_segment: {
    postId: identity.postId,
    accountId: identity.accountId,
    operation: identity.operation,
    segment: 0,
  },
};
const job = {
  publishId: "provider-job",
  phase: "uploading" as const,
  fileSize: 100,
  uploadedBytes: 0,
  attemptedBytes: 100,
};
const success: PostingResult = {
  accountId: identity.accountId,
  platform: "tiktok",
  success: true,
  postId: "public-video",
};
const rejected: PostingResult = {
  accountId: identity.accountId,
  platform: "tiktok",
  success: false,
  error: PostErrorType.API_ERROR,
  message: "Upload returned 404",
  recovery: { outcome: "not_published", retryable: true, phase: "upload", httpStatus: 404 },
};

beforeEach(async () => {
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function makeDue() {
  await prisma.publishCheckpoint.update({ where: key, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
}

it("automatically retries the first-upload 404 with a fresh session and reuses the saved success", async () => {
  const publish = jest.fn(async (context?: DurablePublishContext): Promise<PostingResult> => {
    expect(context?.job).toBeUndefined();
    await context!.saveProgress(job);
    return publish.mock.calls.length === 1 ? rejected : success;
  });
  const first = await runDurablePublish(identity, publish);
  expect(first).toMatchObject({ error: "PUBLISH_RETRY_SCHEDULED" });
  const checkpoint = await prisma.publishCheckpoint.findUniqueOrThrow({ where: key });
  expect(checkpoint).toMatchObject({ state: "retry_wait", attemptCount: 1, progress: null });
  expect(checkpoint.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000);
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_RETRY_SCHEDULED");
  expect(publish).toHaveBeenCalledTimes(1);
  await makeDue();
  expect(await runDurablePublish(identity, publish)).toMatchObject(success);
  expect(await runDurablePublish(identity, publish)).toMatchObject(success);
  expect(publish).toHaveBeenCalledTimes(2);
});

it("stops after three attempts and preserves the budget across later scheduler invocations", async () => {
  const publish = jest.fn().mockResolvedValue(rejected);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await runDurablePublish(identity, publish);
    expect(result.error).toBe(attempt < 3 ? "PUBLISH_RETRY_SCHEDULED" : "PUBLISH_RETRY_EXHAUSTED");
    if (attempt < 3) await makeDue();
  }
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_RETRY_EXHAUSTED");
  expect(publish).toHaveBeenCalledTimes(3);
  expect(await prisma.publishCheckpoint.findUniqueOrThrow({ where: key })).toMatchObject({
    state: "failed",
    attemptCount: 3,
  });
});

it("checks an uncertain job after restart and never initializes a second publication", async () => {
  await runDurablePublish(identity, async (context) => {
    await context!.saveProgress(job);
    throw new Error("Upload response lost");
  });
  const checkpoint = await prisma.publishCheckpoint.findUniqueOrThrow({ where: key });
  expect(checkpoint).toMatchObject({ state: "processing", attemptCount: 1, progress: job });
  await makeDue();
  const prepare = jest.fn();
  const check = jest.fn(async (context?: DurablePublishContext) => {
    expect(context?.job).toEqual(job);
    return success;
  });
  expect(await runDurablePublish(identity, check, prepare)).toMatchObject(success);
  expect(prepare).not.toHaveBeenCalled();
  expect(await prisma.publishCheckpoint.findUniqueOrThrow({ where: key })).toMatchObject({
    state: "succeeded",
    attemptCount: 1,
  });
});

it("recovers an abandoned initialized job after the worker dies", async () => {
  await prisma.publishCheckpoint.create({
    data: {
      ...key.postId_accountId_operation_segment,
      fingerprint: identity.fingerprint,
      recoveryProvider: "tiktok-video",
      attemptCount: 1,
      state: "started",
      progress: job,
      updatedAt: new Date(Date.now() - 31 * 60_000),
      recoveryStartedAt: new Date(Date.now() - 32 * 60_000),
    },
  });
  const check = jest.fn(async (context?: DurablePublishContext) => {
    expect(context?.job).toEqual(job);
    return success;
  });
  expect(await runDurablePublish(identity, check)).toMatchObject(success);
  expect(check).toHaveBeenCalledTimes(1);
});

it("only submits once when two workers race for the same post", async () => {
  let signal!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const publish = jest.fn(async () => {
    signal();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return success;
  });
  const first = runDurablePublish(identity, publish);
  await started;
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_PROCESSING");
  finish();
  expect(await first).toMatchObject(success);
  expect(publish).toHaveBeenCalledTimes(1);
});

it("fences an old worker's response after a stale recovery claim", async () => {
  let signal!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const first = runDurablePublish(identity, async (context) => {
    await context!.saveProgress(job);
    signal();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return rejected;
  });
  await started;
  await prisma.publishCheckpoint.update({ where: key, data: { updatedAt: new Date(Date.now() - 31 * 60_000) } });
  expect(await runDurablePublish(identity, async () => success)).toMatchObject(success);
  finish();
  expect(await first).toMatchObject(success);
  expect(await prisma.publishCheckpoint.findUniqueOrThrow({ where: key })).toMatchObject({ state: "succeeded" });
});

it("never retries a permanent rejection", async () => {
  const publish = jest.fn().mockResolvedValue({ ...rejected, recovery: { ...rejected.recovery, retryable: false } });
  await runDurablePublish(identity, publish);
  await runDurablePublish(identity, publish);
  expect(publish).toHaveBeenCalledTimes(1);
});

it("honors Retry-After and keeps status checks outside the publication attempt budget", async () => {
  const result = await runDurablePublish(identity, async () => ({
    ...rejected,
    recovery: { ...rejected.recovery!, retryAfterMs: 900_000 },
  }));
  expect(result.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(890_000);
  expect(await prisma.publishCheckpoint.findUniqueOrThrow({ where: key })).toMatchObject({ attemptCount: 1 });
});

it("leaves old ambiguous records and changed content for explicit reconciliation", async () => {
  await prisma.publishCheckpoint.create({
    data: { ...key.postId_accountId_operation_segment, fingerprint: identity.fingerprint, state: "unknown" },
  });
  const publish = jest.fn();
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect((await runDurablePublish({ ...identity, fingerprint: "changed" }, publish)).error).toBe(
    "PUBLISH_CONTENT_CHANGED",
  );
  expect(publish).not.toHaveBeenCalled();
});

it("permits an explicit manual retry of a conclusive failure but never clears an uncertain outcome", async () => {
  const permanent = { ...rejected, recovery: { ...rejected.recovery!, retryable: false } };
  await runDurablePublish(identity, async () => permanent);
  const manual = jest.fn().mockResolvedValue(success);
  expect(
    await runDurablePublish({ ...identity, manualRetry: true, fingerprint: "corrected-video" }, manual),
  ).toMatchObject(success);
  expect(manual).toHaveBeenCalledTimes(1);
  await prisma.publishCheckpoint.update({
    where: key,
    data: {
      state: "unknown",
      result: { accountId: identity.accountId, platform: "tiktok", success: false, error: "PUBLISH_OUTCOME_UNKNOWN" },
    },
  });
  expect(
    (await runDurablePublish({ ...identity, manualRetry: true, fingerprint: "corrected-video" }, manual)).error,
  ).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect(manual).toHaveBeenCalledTimes(1);
});

it("stops automatic status checking after the recovery window without publishing a duplicate", async () => {
  await prisma.publishCheckpoint.create({
    data: {
      ...key.postId_accountId_operation_segment,
      fingerprint: identity.fingerprint,
      recoveryProvider: "tiktok-video",
      attemptCount: 1,
      state: "processing",
      progress: job,
      recoveryStartedAt: new Date(Date.now() - 25 * 60 * 60_000),
    },
  });
  const check = jest.fn(async (context?: DurablePublishContext) => {
    expect(context?.job).toEqual(job);
    return { ...rejected, recovery: { outcome: "processing" as const, retryable: false, phase: "status" } };
  });
  expect((await runDurablePublish(identity, check)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect((await runDurablePublish(identity, check)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect(check).toHaveBeenCalledTimes(1);
});

it("keeps a lost checkpoint acknowledgement recoverable instead of failing the post", async () => {
  const save = jest.spyOn(prisma.publishCheckpoint, "updateMany");
  try {
    const result = await runDurablePublish(identity, async (context) => {
      await context!.saveProgress(job);
      save.mockRejectedValueOnce(new Error("Database acknowledgement lost"));
      return success;
    });
    expect(result.error).toBe("PUBLISH_PROCESSING");
    expect(await prisma.publishCheckpoint.findUniqueOrThrow({ where: key })).toMatchObject({
      state: "started",
      progress: job,
    });
  } finally {
    save.mockRestore();
  }
  await prisma.publishCheckpoint.update({ where: key, data: { updatedAt: new Date(Date.now() - 31 * 60_000) } });
  const check = jest.fn(async (context?: DurablePublishContext) => {
    expect(context?.job).toEqual(job);
    return success;
  });
  expect(await runDurablePublish(identity, check)).toMatchObject(success);
});

it("does not resubmit a processing operation whose saved job cannot be read", async () => {
  await prisma.publishCheckpoint.create({
    data: {
      ...key.postId_accountId_operation_segment,
      fingerprint: identity.fingerprint,
      recoveryProvider: "tiktok-video",
      attemptCount: 1,
      state: "processing",
      progress: { publishId: "incomplete" },
    },
  });
  const publish = jest.fn();
  expect((await runDurablePublish(identity, publish)).error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect(publish).not.toHaveBeenCalled();
});
