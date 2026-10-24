/* eslint-disable unicorn/no-await-expression-member -- Database assertions follow each operation. */
import { Prisma } from "@prisma/client";

import {
  inspectPosts,
  inspectPostsOutputSchema,
  updateScheduledPost,
  updateScheduledPostSchema,
  updateScheduledPostOutputSchema,
} from "@/lib/mcp/tools/posts";
import { deferTikTokMinuteLimit } from "@/lib/posting/defer-tiktok-minute-limit";
import { scheduleTikTokRetry } from "@/lib/posting/schedule-tiktok-retry";
import {
  pauseTikTokUploads,
  resumeTikTokUploads,
  pausedTikTokResults,
  approveScheduledTikTokProbe,
} from "@/lib/posting/tiktok-pause";
import { reserveTikTokUploadInit } from "@/lib/posting/tiktok-rate-limit";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/oauth/credential-health", () => ({
  ...jest.requireActual("@/lib/oauth/credential-health"),
  getCredentialIssuesForPublishTime: async () => [],
}));
const userId = "tiktok-recovery-user";
const cap = "spam_risk_too_many_pending_share";
const errorDetails = {
  failedPlatforms: [
    {
      accountId: "tiktok-recovery-account",
      platform: "tiktok",
      error: "PUBLISH_REJECTED",
      details: { phase: "init", code: cap },
    },
  ],
};
const retryAt = "2099-10-25T09:00:00.000Z";

beforeEach(async () => {
  await prisma.publishCheckpoint.deleteMany();
  await prisma.tikTokUploadInitAttempt.deleteMany();
  await prisma.tikTokUploadPause.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      email: "tiktok-recovery@example.com",
      name: "Recovery",
      freeTrial: { create: { expiresAt: new Date("2099-12-01") } },
    },
  });
  await prisma.connectedAccount.create({
    data: {
      id: "tiktok-recovery-account",
      userId,
      platform: "tiktok",
      platformAccountId: "remote",
      accessToken: "unused",
    },
  });
  await prisma.post.create({
    data: {
      id: "recovery-post",
      userId,
      message: "Original caption",
      status: "failed",
      scheduledFor: new Date(),
      errorDetails,
      accountOptions: { "tiktok-recovery-account": { publishMode: "draft" } },
      accountResults: { "tiktok-recovery-account": { success: false, error: "PUBLISH_REJECTED" } },
      accounts: { connect: { id: "tiktok-recovery-account" } },
    },
  });
  await prisma.publishCheckpoint.create({
    data: {
      postId: "recovery-post",
      accountId: "tiktok-recovery-account",
      operation: "post",
      segment: 0,
      state: "failed",
      fingerprint: "original",
    },
  });
});
afterAll(async () => prisma.$disconnect());

it("reschedules the original with content, options, results and checkpoints intact", async () => {
  const original = await prisma.post.findUniqueOrThrow({ where: { id: "recovery-post" } });
  const result = await scheduleTikTokRetry(userId, original.id, retryAt, original.updatedAt.toISOString());
  expect(result.status).toBe("scheduled");
  const saved = await prisma.post.findUniqueOrThrow({ where: { id: original.id } });
  expect(saved.message).toBe(original.message);
  expect(saved.accountOptions).toEqual(original.accountOptions);
  expect(saved.accountResults).toEqual(original.accountResults);
  expect(await prisma.post.count()).toBe(1);
  expect((await prisma.publishCheckpoint.findFirst())?.fingerprint).toBe("original");
  expect((await prisma.tikTokUploadPause.findFirst())?.resumeAt?.toISOString()).toBe(retryAt);
});

it("rejects stale versions, other owners, past times and unknown checkpoints", async () => {
  await expect(scheduleTikTokRetry("another-user", "recovery-post", retryAt)).rejects.toThrow("not found");
  await expect(scheduleTikTokRetry(userId, "recovery-post", retryAt, "2020-01-01T00:00:00.000Z")).rejects.toThrow(
    "changed",
  );
  await expect(scheduleTikTokRetry(userId, "recovery-post", "2020-01-01T00:00:00.000Z")).rejects.toThrow();
  await prisma.publishCheckpoint.updateMany({ data: { state: "unknown" } });
  await expect(scheduleTikTokRetry(userId, "recovery-post", retryAt)).rejects.toThrow("uncertain");
  expect((await prisma.post.findFirst())?.status).toBe("failed");
});

it("pauses the account, permits just one approved probe, and wakes queued posts after success", async () => {
  await pauseTikTokUploads("tiktok-recovery-account", cap);
  await expect(reserveTikTokUploadInit("tiktok-recovery-account")).rejects.toMatchObject({
    details: { localAccountPause: true },
  });
  await scheduleTikTokRetry(userId, "recovery-post", retryAt);
  await prisma.tikTokUploadPause.updateMany({ data: { resumeAt: new Date(Date.now() - 1000) } });
  const start = new Date();
  const probes = await Promise.allSettled([
    reserveTikTokUploadInit("tiktok-recovery-account"),
    reserveTikTokUploadInit("tiktok-recovery-account"),
  ]);
  expect(probes.filter((probe) => probe.status === "fulfilled")).toHaveLength(1);
  await prisma.post.update({ where: { id: "recovery-post" }, data: { tiktokPaused: true } });
  await resumeTikTokUploads("tiktok-recovery-account", start);
  expect(await prisma.tikTokUploadPause.count()).toBe(0);
  expect((await prisma.post.findFirst())?.tiktokPaused).toBe(false);
});

it("retains a newer cap and does not release the queue after an older request succeeds", async () => {
  const startedAt = new Date("2020-01-01");
  await pauseTikTokUploads("tiktok-recovery-account", cap);
  await resumeTikTokUploads("tiktok-recovery-account", startedAt);
  expect(await prisma.tikTokUploadPause.count()).toBe(1);
});

it("short request pauses have a retry time, while inbox pauses wait for user action", async () => {
  await pauseTikTokUploads("tiktok-recovery-account", "rate_limit_exceeded");
  expect((await pausedTikTokResults(["tiktok-recovery-account"]))[0]).toMatchObject({ error: "LOCAL_RATE_LIMIT" });
  expect((await prisma.tikTokUploadPause.findFirst())?.resumeAt).toBeInstanceOf(Date);
  await pauseTikTokUploads("tiktok-recovery-account", cap);
  expect((await pausedTikTokResults(["tiktok-recovery-account"]))[0]).toMatchObject({ error: "TIKTOK_ACCOUNT_PAUSED" });
  expect((await prisma.tikTokUploadPause.findFirst())?.resumeAt).toBeNull();
});

it("exposes actionable MCP recovery and schedules it through the existing tool", async () => {
  const inspected = await inspectPosts(userId, { postId: "recovery-post", status: "all", page: 1, limit: 10 });
  expect(inspectPostsOutputSchema.parse(inspected).posts[0].recovery).toMatchObject({
    canScheduleRetry: true,
    code: cap,
  });
  const result = await updateScheduledPost(
    userId,
    updateScheduledPostSchema.parse({
      postId: "recovery-post",
      postingMode: "schedule",
      scheduledFor: retryAt,
      expectedUpdatedAt: inspected.posts[0].updatedAt,
    }),
  );
  expect(updateScheduledPostOutputSchema.parse(result).post).toMatchObject({
    id: "recovery-post",
    status: "scheduled",
    scheduledFor: retryAt,
  });
  expect(await prisma.post.count()).toBe(1);
});

it("does not offer a cap recovery for a generic or banned failure", async () => {
  await prisma.post.updateMany({ data: { errorDetails: Prisma.DbNull } });
  await expect(scheduleTikTokRetry(userId, "recovery-post", retryAt)).rejects.toThrow("does not have a recoverable");
});

it("honors the next explicitly approved retry even when a previous attempt hit the cap again", async () => {
  await scheduleTikTokRetry(userId, "recovery-post", retryAt);
  await pauseTikTokUploads("tiktok-recovery-account", cap);
  await expect(reserveTikTokUploadInit("tiktok-recovery-account")).rejects.toMatchObject({
    details: { localAccountPause: true },
  });
  await approveScheduledTikTokProbe("recovery-post", ["tiktok-recovery-account"]);
  await expect(reserveTikTokUploadInit("tiktok-recovery-account")).resolves.toBeUndefined();
  expect((await prisma.post.findFirst())?.tiktokRetryApproved).toBe(false);
});

it("queues a Post Now minute limit on the original record and preserves successful targets", async () => {
  const results = [
    { accountId: "tiktok-recovery-account", platform: "tiktok", success: false, error: "LOCAL_RATE_LIMIT" },
  ];
  const progress = { another: { success: true, postId: "already-published" } };
  const before = Date.now();
  expect(await deferTikTokMinuteLimit("recovery-post", results, progress, {})).toBe(true);
  const saved = await prisma.post.findFirstOrThrow();
  expect(saved.status).toBe("scheduled");
  expect(saved.scheduledFor!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  expect(saved.accountResults).toEqual(progress);
  expect(await prisma.post.count()).toBe(1);
  expect(
    await deferTikTokMinuteLimit("recovery-post", [{ ...results[0], error: "PUBLISH_OUTCOME_UNKNOWN" }], {}, {}),
  ).toBe(false);
});
