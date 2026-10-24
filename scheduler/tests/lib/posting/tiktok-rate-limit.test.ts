import { reserveTikTokUploadInit } from "@/lib/posting/tiktok-rate-limit";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    tikTokUploadInitAttempt: { count: jest.fn(), create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  tikTokUploadInitAttempt: { count: jest.Mock; create: jest.Mock };
};
const now = new Date("2026-10-24T09:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation((run) => run(db));
  db.$queryRaw.mockResolvedValue([{ now }]);
});

it("reserves the sixth initialization using the database clock and an account-specific lock", async () => {
  db.tikTokUploadInitAttempt.count.mockResolvedValue(5);
  await reserveTikTokUploadInit("account-a");
  expect(db.$queryRaw.mock.calls[0][0].values).toEqual(["tiktok-upload-init:account-a"]);
  expect(db.tikTokUploadInitAttempt.count).toHaveBeenCalledWith({
    where: { accountId: "account-a", createdAt: { gt: new Date(now.getTime() - 60_000) } },
  });
  expect(db.tikTokUploadInitAttempt.create).toHaveBeenCalledWith({ data: { accountId: "account-a", createdAt: now } });
});

it("rejects the seventh initialization before consuming another request", async () => {
  db.tikTokUploadInitAttempt.count.mockResolvedValue(6);
  await expect(reserveTikTokUploadInit("account-a")).rejects.toMatchObject({
    errorType: "RATE_LIMIT_ERROR",
    details: { phase: "init", localRateLimit: true },
  });
  expect(db.tikTokUploadInitAttempt.create).not.toHaveBeenCalled();
});

it("does not use a full account's budget for a different account", async () => {
  db.tikTokUploadInitAttempt.count.mockImplementation(async ({ where }) => (where.accountId === "full" ? 6 : 0));
  await expect(reserveTikTokUploadInit("full")).rejects.toThrow("6 requests per minute");
  await expect(reserveTikTokUploadInit("other")).resolves.toBeUndefined();
  expect(db.tikTokUploadInitAttempt.create).toHaveBeenCalledTimes(1);
});
