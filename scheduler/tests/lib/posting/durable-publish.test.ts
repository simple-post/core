import { runDurablePublish } from "@/lib/posting/durable-publish";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    publishCheckpoint: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    publishAttempt: { count: jest.fn(), create: jest.fn() },
  },
}));
const db = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  publishCheckpoint: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  publishAttempt: { count: jest.Mock; create: jest.Mock };
};
const input = {
  postId: "post",
  accountId: "account",
  platform: "tiktok",
  operation: "post" as const,
  segment: 0,
  fingerprint: "content",
};
beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation((run) => run(db));
  db.$queryRaw.mockResolvedValue([{ now: new Date() }]);
  db.publishAttempt.count.mockResolvedValue(0);
  db.publishCheckpoint.findUnique.mockResolvedValue(null);
});
it.each([
  ["PREPARATION_ERROR", "failed"],
  ["PUBLISH_REJECTED", "failed"],
  ["LOCAL_RATE_LIMIT", "failed"],
  ["API_ERROR", "unknown"],
])("records %s with the correct retry boundary", async (error, state) => {
  const publish = jest
    .fn()
    .mockResolvedValue({ accountId: "account", platform: "tiktok", success: false, error, message: "Failed" });
  const result = await runDurablePublish(input, publish);
  expect(db.publishCheckpoint.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ state }) }),
  );
  expect(result.error).toBe(state === "unknown" ? "PUBLISH_OUTCOME_UNKNOWN" : error);
});
it("does not resubmit an existing unknown outcome", async () => {
  db.publishCheckpoint.findUnique.mockResolvedValue({ state: "unknown", fingerprint: input.fingerprint });
  const publish = jest.fn();
  const result = await runDurablePublish(input, publish);
  expect(result.error).toBe("PUBLISH_OUTCOME_UNKNOWN");
  expect(publish).not.toHaveBeenCalled();
});

it("allows a fresh attempt after TikTok confirms a terminal photo-download failure", async () => {
  const publish = jest
    .fn()
    .mockResolvedValueOnce({
      accountId: "account",
      platform: "tiktok",
      success: false,
      error: "PUBLISH_REJECTED",
      details: { phase: "status", status: "FAILED", code: "photo_pull_failed", publishId: "failed-job" },
    })
    .mockResolvedValueOnce({ accountId: "account", platform: "tiktok", success: true, postId: "published" });
  expect(await runDurablePublish(input, publish)).toMatchObject({ error: "PUBLISH_REJECTED" });
  expect(db.publishCheckpoint.update.mock.calls[0][0].data.state).toBe("failed");
  db.publishCheckpoint.findUnique.mockResolvedValue({ state: "failed", fingerprint: input.fingerprint });
  expect(await runDurablePublish(input, publish)).toMatchObject({ success: true, postId: "published" });
  expect(publish).toHaveBeenCalledTimes(2);
});

it("allows retry of a definite Facebook rejection and retains accepted IDs on uncertain results", async () => {
  const facebook = { ...input, platform: "facebook" };
  db.publishCheckpoint.findUnique.mockResolvedValue({ state: "failed", fingerprint: input.fingerprint });
  const publish = jest.fn().mockResolvedValue({
    accountId: "account",
    platform: "facebook",
    success: false,
    error: "API_ERROR",
    details: { stage: "processing", videoId: "accepted_video" },
  });
  const result = await runDurablePublish(facebook, publish);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ error: "PUBLISH_OUTCOME_UNKNOWN", details: { videoId: "accepted_video" } });
  expect(db.publishCheckpoint.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        state: "unknown",
        result: expect.objectContaining({ details: { stage: "processing", videoId: "accepted_video" } }),
      }),
    }),
  );
});

it("allows retry of a rejected TikTok upload but blocks resubmission after uncertain processing", async () => {
  db.publishCheckpoint.findUnique.mockResolvedValue({ state: "failed", fingerprint: input.fingerprint });
  const publish = jest.fn().mockResolvedValue({
    accountId: "account",
    platform: "tiktok",
    success: false,
    error: "API_ERROR",
    details: { phase: "status", publishId: "accepted_video" },
  });
  const result = await runDurablePublish(input, publish);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ error: "PUBLISH_OUTCOME_UNKNOWN", details: { publishId: "accepted_video" } });
  const { data } = db.publishCheckpoint.update.mock.calls[0][0];
  expect(data.state).toBe("unknown");
  db.publishCheckpoint.findUnique.mockResolvedValue({ ...data, fingerprint: input.fingerprint });
  expect(await runDurablePublish(input, publish)).toMatchObject({ error: "PUBLISH_OUTCOME_UNKNOWN" });
  expect(publish).toHaveBeenCalledTimes(1);
});
