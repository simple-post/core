import {
  batchOutcome,
  dispatchOutcome,
  recordPostingBatch,
  recordScheduledDispatch,
  withAccountPublishSpan,
  withPostingBatch,
  withScheduledDispatch,
  withSpan,
} from "@/lib/observability/telemetry";
import type { TelemetryDispatchResult } from "@/lib/observability/telemetry";

const dispatchResult: TelemetryDispatchResult = {
  processedPosts: 2,
  publishedPosts: 1,
  failedPosts: 1,
  skippedPosts: 3,
  staleRecoveredPosts: 1,
  processedReposts: 1,
  completedReposts: 1,
  failedReposts: 0,
  skippedReposts: 0,
  staleRecoveredReposts: 0,
  credentialRefresh: { refreshed: 1, failed: 1, skipped: 1 },
};

describe("observability telemetry", () => {
  it("preserves successful operation results when no SDK is configured", async () => {
    await expect(withSpan("test.operation", { "test.attribute": "safe" }, async () => "result")).resolves.toBe(
      "result",
    );
  });

  it("preserves operation failures when no SDK is configured", async () => {
    const error = new Error("provider secret must not become a span attribute");
    await expect(
      withSpan("test.failure", {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("classifies batch outcomes including total failure", () => {
    expect(batchOutcome(3, 0)).toBe("success");
    expect(batchOutcome(3, 1)).toBe("partial_failure");
    expect(batchOutcome(3, 3)).toBe("failure");
  });

  it("counts credential-refresh failures as a partial dispatch failure", () => {
    expect(dispatchOutcome(dispatchResult)).toBe("partial_failure");
    expect(
      dispatchOutcome({
        ...dispatchResult,
        failedPosts: 0,
        credentialRefresh: { refreshed: 1, failed: 0, skipped: 0 },
      }),
    ).toBe("success");
  });

  it("records posting batches and returns the shared outcome", () => {
    expect(
      recordPostingBatch("post", 1250, [
        { platform: "X", success: true },
        { platform: "LinkedIn", success: false },
      ]),
    ).toEqual({ failures: 1, outcome: "partial_failure" });
    expect(
      recordPostingBatch("post", 900, [
        { platform: "X", success: false },
        { platform: "LinkedIn", success: false },
      ]),
    ).toEqual({ failures: 2, outcome: "failure" });
  });

  it("records dispatch dimensions without requiring an exporter", () => {
    expect(() => recordScheduledDispatch(2500, dispatchResult)).not.toThrow();
  });

  it("passes results and rethrown errors through the batch and dispatch wrappers", async () => {
    const results = [{ platform: "X", success: true }];
    await expect(withPostingBatch("post", "simplepost.publish", {}, async () => results)).resolves.toBe(results);
    await expect(withScheduledDispatch(async () => dispatchResult)).resolves.toBe(dispatchResult);
    await expect(withAccountPublishSpan("post", "X", {}, async () => ({ success: false }))).resolves.toEqual({
      success: false,
    });

    const error = new Error("batch failed");
    await expect(
      withPostingBatch("repost", "simplepost.repost", {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(
      withScheduledDispatch(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
