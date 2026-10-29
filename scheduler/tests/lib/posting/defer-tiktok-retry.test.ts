import type { PostingResult } from "@/lib/posting";
import { deferTikTokRetry } from "@/lib/posting/defer-tiktok-retry";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { post: { update: jest.fn() } } }));
const update = jest.mocked(prisma.post.update);
const failure: PostingResult = {
  accountId: "tiktok",
  platform: "tiktok",
  success: false,
  error: "PUBLISH_REJECTED",
  details: { phase: "status", status: "FAILED", code: "photo_pull_failed", publishId: "failed-job" },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-29T14:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it("retries the original three times at the existing one-minute interval, preserving successes, then stops", async () => {
  let errorDetails: unknown;
  const accountResults = { instagram: { success: true, postId: "published" }, tiktok: { success: false } };
  const threads = { instagram: [{ index: 0, success: true }] };
  for (let index = 0; index < 3; index += 1) {
    expect(await deferTikTokRetry("original", [failure], accountResults, threads, false, errorDetails)).toBe(true);
    const data = update.mock.calls.at(-1)![0].data;
    expect(update.mock.calls.at(-1)![0].where).toEqual({ id: "original" });
    expect(data).toMatchObject({
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 60_000),
      accountResults,
      threadResults: threads,
      errorDetails: { tiktokProcessingRetryCount: index + 1, failedPlatforms: [failure] },
    });
    errorDetails = data.errorDetails;
  }
  expect(await deferTikTokRetry("original", [failure], accountResults, threads, false, errorDetails)).toBe(false);
  expect(update).toHaveBeenCalledTimes(3);
});

it("retains the processing retry budget across intervening minute limits", async () => {
  const limited = { ...failure, error: "LOCAL_RATE_LIMIT", details: undefined };
  expect(await deferTikTokRetry("original", [limited], {}, {}, true, { tiktokProcessingRetryCount: 2 })).toBe(true);
  const data = update.mock.calls.at(-1)![0].data;
  expect(data).toMatchObject({
    tiktokRetryApproved: true,
    scheduledFor: new Date(Date.now() + 60_000),
    errorDetails: { tiktokProcessingRetryCount: 2 },
  });
  expect(await deferTikTokRetry("original", [failure], {}, {}, false, data.errorDetails)).toBe(true);
  expect(update.mock.calls.at(-1)![0].data.errorDetails).toMatchObject({ tiktokProcessingRetryCount: 3 });
});

it.each(["photo_pull_failed", "video_pull_failed", "internal"])("queues a confirmed transient %s", async (code) => {
  expect(
    await deferTikTokRetry("original", [{ ...failure, details: { phase: "status", status: "FAILED", code } }], {}, {}),
  ).toBe(true);
});

it.each([
  { ...failure, error: "API_ERROR" },
  { ...failure, error: "PUBLISH_OUTCOME_UNKNOWN" },
  { ...failure, details: { phase: "init", code: "photo_pull_failed" } },
  { ...failure, details: { phase: "status", status: "PROCESSING_DOWNLOAD", code: "photo_pull_failed" } },
  { ...failure, details: { phase: "status", status: "FAILED", code: "spam_risk" } },
  { ...failure, details: { phase: "status", status: "FAILED", code: "picture_size_check_failed" } },
  { ...failure, platform: "instagram" },
])("does not automatically retry an unsafe or permanent failure: %j", async (result) => {
  expect(await deferTikTokRetry("original", [result], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

it("does not hide an uncertain destination behind a transient TikTok failure", async () => {
  expect(
    await deferTikTokRetry(
      "original",
      [failure, { ...failure, accountId: "other", error: "PUBLISH_OUTCOME_UNKNOWN" }],
      {},
      {},
    ),
  ).toBe(false);
  expect(await deferTikTokRetry("original", [], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});
