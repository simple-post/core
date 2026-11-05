import type { PostingResult } from "@/lib/posting";
import { deferPostRetry } from "@/lib/posting/defer-post-retry";
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
    expect(await deferPostRetry("original", [failure], accountResults, threads, false, errorDetails)).toBe(true);
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
  expect(await deferPostRetry("original", [failure], accountResults, threads, false, errorDetails)).toBe(false);
  expect(update).toHaveBeenCalledTimes(3);
});

it("retains the processing retry budget across intervening minute limits", async () => {
  const limited = { ...failure, error: "LOCAL_RATE_LIMIT", details: undefined };
  expect(await deferPostRetry("original", [limited], {}, {}, true, { tiktokProcessingRetryCount: 2 })).toBe(true);
  const data = update.mock.calls.at(-1)![0].data;
  expect(data).toMatchObject({
    tiktokRetryApproved: true,
    scheduledFor: new Date(Date.now() + 60_000),
    errorDetails: { tiktokProcessingRetryCount: 2 },
  });
  expect(await deferPostRetry("original", [failure], {}, {}, false, data.errorDetails)).toBe(true);
  expect(update.mock.calls.at(-1)![0].data.errorDetails).toMatchObject({ tiktokProcessingRetryCount: 3 });
});

it.each(["photo_pull_failed", "video_pull_failed", "internal"])("queues a confirmed transient %s", async (code) => {
  expect(
    await deferPostRetry("original", [{ ...failure, details: { phase: "status", status: "FAILED", code } }], {}, {}),
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
  expect(await deferPostRetry("original", [result], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

it("does not hide an uncertain destination behind a transient TikTok failure", async () => {
  expect(
    await deferPostRetry(
      "original",
      [failure, { ...failure, accountId: "other", error: "PUBLISH_OUTCOME_UNKNOWN" }],
      {},
      {},
    ),
  ).toBe(false);
  expect(await deferPostRetry("original", [], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

const instagramFailure: PostingResult = {
  accountId: "instagram",
  platform: "instagram",
  success: false,
  error: "PREPARATION_ERROR",
  details: { phase: "processing", statusCode: "ERROR", status: "ERROR", containerId: "failed-container" },
};

it.each(["ERROR", "EXPIRED"])(
  "bounds retries of Instagram's terminal %s state while preserving published targets",
  async (statusCode) => {
    const result = {
      ...instagramFailure,
      details: { phase: "processing", statusCode, containerId: "failed-container" },
    };
    const accountResults = { x: { success: true, postId: "already-published" }, instagram: { success: false } };
    const threads = { x: [{ index: 0, success: true, postId: "already-published" }] };
    let errorDetails: unknown = { diagnostic: "keep" };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await deferPostRetry("original", [result], accountResults, threads, false, errorDetails)).toBe(true);
      const data = update.mock.calls.at(-1)![0].data;
      expect(data).toMatchObject({
        status: "scheduled",
        scheduledFor: new Date(Date.now() + 60_000),
        errorMessage: `Instagram could not process the media. Retry ${attempt} of 3 is scheduled in one minute.`,
        errorDetails: { diagnostic: "keep", instagramProcessingRetryCount: attempt, failedPlatforms: [result] },
        accountResults,
        threadResults: threads,
      });
      errorDetails = data.errorDetails;
    }
    expect(await deferPostRetry("original", [result], accountResults, threads, false, errorDetails)).toBe(false);
    expect(update).toHaveBeenCalledTimes(3);
  },
);

it("retains independent retry budgets for a mixed Instagram and TikTok post", async () => {
  expect(
    await deferPostRetry("original", [failure, instagramFailure], {}, {}, false, {
      tiktokProcessingRetryCount: 2,
      instagramProcessingRetryCount: 1,
    }),
  ).toBe(true);
  const details = update.mock.calls.at(-1)![0].data.errorDetails;
  expect(details).toMatchObject({ tiktokProcessingRetryCount: 3, instagramProcessingRetryCount: 2 });
  const limited = { ...failure, error: "LOCAL_RATE_LIMIT", details: undefined };
  expect(await deferPostRetry("original", [limited, instagramFailure], {}, {}, false, details)).toBe(true);
  expect(update.mock.calls.at(-1)![0].data.errorDetails).toMatchObject({
    tiktokProcessingRetryCount: 3,
    instagramProcessingRetryCount: 3,
  });
  expect(await deferPostRetry("original", [failure, instagramFailure], {}, {}, false, details)).toBe(false);
  expect(update).toHaveBeenCalledTimes(2);
});

it.each([
  { ...instagramFailure, error: "API_ERROR" },
  { ...instagramFailure, error: "PUBLISH_OUTCOME_UNKNOWN" },
  { ...instagramFailure, error: "CREDENTIALS_ERROR" },
  { ...instagramFailure, platform: "facebook" },
  { ...instagramFailure, details: undefined },
  { ...instagramFailure, details: { phase: "processing", containerId: "container" } },
  { ...instagramFailure, details: { phase: "processing", statusCode: "IN_PROGRESS", containerId: "container" } },
  { ...instagramFailure, details: { phase: "publish", statusCode: "ERROR", containerId: "container" } },
  { ...instagramFailure, details: { phase: "create_media", statusCode: "ERROR", containerId: "container" } },
  { ...instagramFailure, details: { phase: "processing", statusCode: "ERROR" } },
  { ...instagramFailure, details: { phase: "processing", statusCode: "ERROR", containerId: "" } },
  { ...instagramFailure, details: { phase: "processing", httpStatus: 400, error: { code: 100 } } },
])("does not requeue unsupported or uncertain Instagram failures: %j", async (result) => {
  expect(await deferPostRetry("original", [result], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

it("does not hide another destination's permanent or uncertain failure behind Instagram retries", async () => {
  for (const error of ["PUBLISH_OUTCOME_UNKNOWN", "INVALID_CONTENT", "CREDENTIALS_ERROR"]) {
    expect(await deferPostRetry("original", [instagramFailure, { ...failure, error }], {}, {})).toBe(false);
  }
  expect(await deferPostRetry("original", [{ ...instagramFailure, success: true }], {}, {})).toBe(false);
  expect(update).not.toHaveBeenCalled();
});
