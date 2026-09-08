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
