import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

import type { Attributes, Counter, Histogram, Span } from "@opentelemetry/api";

// The tracer proxy in @opentelemetry/api late-binds to the provider, so it is
// safe to create at import time.
const tracer = trace.getTracer("simplepost.scheduler");

interface Instruments {
  postingTargets: Counter;
  postingBatches: Counter;
  postingBatchDuration: Histogram;
  dispatchRuns: Counter;
  dispatchDuration: Histogram;
  dispatchedPosts: Counter;
  staleRecovered: Counter;
  schedulerQueueLag: Histogram;
  credentialRefreshes: Counter;
}

let instrumentsCache: Instruments | undefined;

/**
 * Instruments are created on first use, not at import time: unlike traces,
 * the metrics API has no proxy, so instruments created before instrumentation.ts
 * registers the MeterProvider would be frozen as permanent no-ops.
 */
function instruments(): Instruments {
  instrumentsCache ??= (() => {
    const meter = metrics.getMeter("simplepost.scheduler");
    return {
      postingTargets: meter.createCounter("simplepost.posting.targets", {
        description: "Number of target-platform publishing results",
        unit: "{target}",
      }),
      postingBatches: meter.createCounter("simplepost.posting.batches", {
        description: "Number of publishing batches by outcome",
        unit: "{batch}",
      }),
      postingBatchDuration: meter.createHistogram("simplepost.posting.batch.duration", {
        description: "End-to-end duration of a publishing batch",
        unit: "s",
      }),
      dispatchRuns: meter.createCounter("simplepost.scheduler.dispatch.runs", {
        description: "Number of scheduled dispatch runs",
        unit: "{run}",
      }),
      dispatchDuration: meter.createHistogram("simplepost.scheduler.dispatch.duration", {
        description: "Duration of a scheduled dispatch run",
        unit: "s",
      }),
      dispatchedPosts: meter.createCounter("simplepost.scheduler.posts", {
        description: "Number of posts handled by scheduled dispatch",
        unit: "{post}",
      }),
      staleRecovered: meter.createCounter("simplepost.scheduler.stale_recovered", {
        description: "Number of stale pending posts or reposts recovered",
        unit: "{post}",
      }),
      schedulerQueueLag: meter.createHistogram("simplepost.scheduler.queue.lag", {
        description: "Age of the oldest due item when a dispatch run starts",
        unit: "s",
      }),
      credentialRefreshes: meter.createCounter("simplepost.credentials.refresh", {
        description: "Scheduled credential refresh results",
        unit: "{account}",
      }),
    };
  })();
  return instrumentsCache;
}

export interface TelemetryPostingResult {
  platform: string;
  success: boolean;
}

export interface TelemetryDispatchResult {
  processedPosts: number;
  publishedPosts: number;
  failedPosts: number;
  skippedPosts: number;
  staleRecoveredPosts: number;
  processedReposts: number;
  completedReposts: number;
  failedReposts: number;
  skippedReposts: number;
  staleRecoveredReposts: number;
  credentialRefresh: {
    refreshed: number;
    failed: number;
    skipped: number;
  };
}

export type BatchOutcome = "success" | "partial_failure" | "failure";

export function batchOutcome(total: number, failures: number): BatchOutcome {
  if (failures === 0) return "success";
  return failures === total ? "failure" : "partial_failure";
}

/**
 * Single source of the dispatch-run outcome so the span attribute and the
 * dispatch.runs metric can never disagree. Credential-refresh failures count
 * as a partial failure: the run did not complete all of its work.
 */
export function dispatchOutcome(result: TelemetryDispatchResult): "success" | "partial_failure" {
  return result.failedPosts > 0 || result.failedReposts > 0 || result.credentialRefresh.failed > 0
    ? "partial_failure"
    : "success";
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException({
        name: error instanceof Error ? error.name : "Error",
        message: "Operation failed; see correlated logs for redacted details",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps a publishing batch (post or repost) in a span and records the batch
 * metrics, including the failure metric when the batch throws.
 */
export async function withPostingBatch<T extends TelemetryPostingResult>(
  operation: "post" | "repost",
  spanName: string,
  attributes: Attributes,
  run: () => Promise<T[]>,
): Promise<T[]> {
  const startedAt = Date.now();
  return withSpan(spanName, { "simplepost.operation": operation, ...attributes }, async (span) => {
    try {
      const results = await run();
      const { failures, outcome } = recordPostingBatch(operation, Date.now() - startedAt, results);
      span.setAttributes({
        "simplepost.success_count": results.length - failures,
        "simplepost.failure_count": failures,
        "simplepost.outcome": outcome,
      });
      if (failures > 0) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `${failures} publishing target(s) failed` });
      }
      return results;
    } catch (error) {
      recordPostingFailure(operation, Date.now() - startedAt);
      throw error;
    }
  });
}

/**
 * Wraps the publish to a single target platform in a "simplepost.publish.account"
 * span whose outcome attribute is derived from the returned result.
 */
export async function withAccountPublishSpan<
  T extends { success: boolean; error?: string; message?: string; details?: unknown },
>(operation: "post" | "repost", platform: string, attributes: Attributes, run: () => Promise<T>): Promise<T> {
  return withSpan(
    "simplepost.publish.account",
    { "simplepost.operation": operation, "social.platform": platform.toLowerCase(), ...attributes },
    async (span) => {
      const result = await run();
      span.setAttribute("simplepost.outcome", result.success ? "success" : "failure");
      if (!result.success) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Publishing target failed" });
        if (result.error) span.setAttribute("error.type", result.error);
        if (result.message) span.setAttribute("error.message", result.message.slice(0, 500));
        if (typeof result.details === "object" && result.details !== null && "code" in result.details) {
          const code = (result.details as { code?: unknown }).code;
          if (typeof code === "string") span.setAttribute("simplepost.error.code", code);
        }
      }
      return result;
    },
  );
}

/**
 * Wraps a scheduled dispatch run in a span and records the dispatch metrics,
 * including the failure metric when the run throws.
 */
export async function withScheduledDispatch<T extends TelemetryDispatchResult>(run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  return withSpan("simplepost.scheduler.dispatch", { "simplepost.operation": "scheduled_dispatch" }, async (span) => {
    try {
      const result = await run();
      span.setAttributes({
        "simplepost.processed_posts": result.processedPosts,
        "simplepost.published_posts": result.publishedPosts,
        "simplepost.failed_posts": result.failedPosts,
        "simplepost.skipped_posts": result.skippedPosts,
        "simplepost.processed_reposts": result.processedReposts,
        "simplepost.failed_reposts": result.failedReposts,
        "simplepost.stale_recovered": result.staleRecoveredPosts + result.staleRecoveredReposts,
        "simplepost.outcome": dispatchOutcome(result),
      });
      if (dispatchOutcome(result) === "partial_failure") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Scheduled dispatch contained failures" });
      }
      recordScheduledDispatch(Date.now() - startedAt, result);
      return result;
    } catch (error) {
      recordScheduledDispatchFailure(Date.now() - startedAt);
      throw error;
    }
  });
}

export function recordPostingBatch(
  operation: "post" | "repost",
  durationMs: number,
  results: TelemetryPostingResult[],
): { failures: number; outcome: BatchOutcome } {
  const failures = results.filter((result) => !result.success).length;
  const outcome = batchOutcome(results.length, failures);
  instruments().postingBatches.add(1, {
    "simplepost.operation": operation,
    "simplepost.outcome": outcome,
  });
  instruments().postingBatchDuration.record(durationMs / 1000, { "simplepost.operation": operation });
  for (const result of results) {
    instruments().postingTargets.add(1, {
      "simplepost.operation": operation,
      "social.platform": result.platform.toLowerCase(),
      "simplepost.outcome": result.success ? "success" : "failure",
    });
  }
  return { failures, outcome };
}

export function recordPostingFailure(operation: "post" | "repost", durationMs: number): void {
  instruments().postingBatches.add(1, { "simplepost.operation": operation, "simplepost.outcome": "failure" });
  instruments().postingBatchDuration.record(durationMs / 1000, { "simplepost.operation": operation });
}

export function recordSchedulerQueueLag(operation: "post" | "repost", lagMs: number): void {
  instruments().schedulerQueueLag.record(Math.max(0, lagMs) / 1000, { "simplepost.operation": operation });
}

export function recordScheduledDispatchFailure(durationMs: number): void {
  instruments().dispatchRuns.add(1, { "simplepost.outcome": "failure" });
  instruments().dispatchDuration.record(durationMs / 1000);
}

function addCount(counter: Counter, value: number, attributes: Attributes): void {
  if (value > 0) counter.add(value, attributes);
}

export function recordScheduledDispatch(durationMs: number, result: TelemetryDispatchResult): void {
  const { dispatchRuns, dispatchDuration, dispatchedPosts, staleRecovered, credentialRefreshes } = instruments();
  dispatchRuns.add(1, { "simplepost.outcome": dispatchOutcome(result) });
  dispatchDuration.record(durationMs / 1000);

  addCount(dispatchedPosts, result.publishedPosts, { "simplepost.operation": "post", "simplepost.outcome": "success" });
  addCount(dispatchedPosts, result.failedPosts, { "simplepost.operation": "post", "simplepost.outcome": "failure" });
  addCount(dispatchedPosts, result.skippedPosts, { "simplepost.operation": "post", "simplepost.outcome": "skipped" });
  addCount(dispatchedPosts, result.completedReposts, {
    "simplepost.operation": "repost",
    "simplepost.outcome": "success",
  });
  addCount(dispatchedPosts, result.failedReposts, {
    "simplepost.operation": "repost",
    "simplepost.outcome": "failure",
  });
  addCount(dispatchedPosts, result.skippedReposts, {
    "simplepost.operation": "repost",
    "simplepost.outcome": "skipped",
  });
  addCount(staleRecovered, result.staleRecoveredPosts, { "simplepost.operation": "post" });
  addCount(staleRecovered, result.staleRecoveredReposts, { "simplepost.operation": "repost" });
  addCount(credentialRefreshes, result.credentialRefresh.refreshed, { "simplepost.outcome": "success" });
  addCount(credentialRefreshes, result.credentialRefresh.failed, { "simplepost.outcome": "failure" });
  addCount(credentialRefreshes, result.credentialRefresh.skipped, { "simplepost.outcome": "skipped" });
}
