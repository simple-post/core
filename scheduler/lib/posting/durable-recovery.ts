import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import type { PostingResult } from "@/lib/posting";
import type { PublishIdentity } from "@/lib/posting/durable-publish";
import { platformLimit, RATE_WINDOW_MS } from "@/lib/posting/publish-limits";
import {
  MAX_PUBLISH_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  STATUS_CHECK_INTERVAL_MS,
  retryDelay,
  type DurablePublishContext,
} from "@/lib/posting/recovery";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

import type { TikTokVideoJob } from "@simple-post/sdk";

const log = createLogger("publish-recovery");
const STALE_WORKER_MS = 30 * 60 * 1000;

function readJob(value: Prisma.JsonValue | null): TikTokVideoJob | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (
    typeof value.publishId !== "string" ||
    !value.publishId ||
    !["initialized", "uploading", "uploaded"].includes(String(value.phase)) ||
    typeof value.fileSize !== "number" ||
    value.fileSize <= 0 ||
    typeof value.uploadedBytes !== "number" ||
    typeof value.attemptedBytes !== "number"
  )
    return;
  return value as unknown as TikTokVideoJob;
}

/** Only explicitly opted-in providers can resume or automatically retry an operation. */
export async function runRecoverablePublish(
  input: PublishIdentity,
  publish: (context?: DurablePublishContext) => Promise<PostingResult>,
  prepare?: () => Promise<void>,
): Promise<PostingResult> {
  const key = { postId: input.postId, accountId: input.accountId, operation: input.operation, segment: input.segment };
  const where = { postId_accountId_operation_segment: key };
  const failure = (error: string, message: string, nextAttemptAt?: Date): PostingResult => ({
    accountId: input.accountId,
    platform: input.platform,
    success: false,
    error,
    message,
    nextAttemptAt,
  });
  const leaseId = randomUUID();
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`publish:${input.platform}`}, 0))::text`,
    );
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
    const previous = await tx.publishCheckpoint.findUnique({ where });
    if (previous) {
      if (previous.fingerprint !== input.fingerprint && !(previous.state === "failed" && input.manualRetry))
        return {
          result: failure(
            "PUBLISH_CONTENT_CHANGED",
            "Restore the original content to resume publishing, or explicitly duplicate it.",
          ),
        };
      if (previous.state === "succeeded") return { result: previous.result as unknown as PostingResult };
      if (previous.recoveryProvider !== input.recoveryProvider && previous.state !== "failed")
        return {
          result: failure(
            "PUBLISH_OUTCOME_UNKNOWN",
            "Check the previous publishing outcome before retrying this post.",
          ),
        };
      if (previous.nextAttemptAt && previous.nextAttemptAt > now)
        return {
          result: failure(
            previous.state === "retry_wait" ? "PUBLISH_RETRY_SCHEDULED" : "PUBLISH_PROCESSING",
            previous.state === "retry_wait"
              ? `Retrying — attempt ${previous.attemptCount + 1} of ${MAX_PUBLISH_ATTEMPTS}.`
              : "Processing on TikTok. We will check again.",
            previous.nextAttemptAt,
          ),
        };
      if (previous.state === "started" && now.getTime() - previous.updatedAt.getTime() < STALE_WORKER_MS)
        return {
          result: failure(
            "PUBLISH_PROCESSING",
            "Publishing is still in progress.",
            new Date(now.getTime() + STATUS_CHECK_INTERVAL_MS),
          ),
        };
      if (previous.state === "unknown" || (previous.state === "failed" && previous.result && !input.manualRetry))
        return {
          result: previous.result
            ? (previous.result as unknown as PostingResult)
            : failure("PUBLISH_OUTCOME_UNKNOWN", "Check the previous publishing outcome before retrying this post."),
        };
    }
    const restarting = previous?.state === "failed" && (input.manualRetry || !previous.result);
    const job = restarting ? undefined : readJob(previous?.progress ?? null);
    if (previous && !restarting && ((previous.progress && !job) || (previous.state === "processing" && !job))) {
      return {
        result: failure(
          "PUBLISH_OUTCOME_UNKNOWN",
          "The saved TikTok job is incomplete. Check its outcome before retrying.",
        ),
      };
    }
    const checking = !!job && previous?.state !== "retry_wait";
    const attemptCount = restarting ? 0 : (previous?.attemptCount ?? 0);
    if (!checking && attemptCount >= MAX_PUBLISH_ATTEMPTS)
      return {
        result: failure("PUBLISH_RETRY_EXHAUSTED", `Publishing failed after ${MAX_PUBLISH_ATTEMPTS} attempts.`),
      };
    const attempts = await tx.publishAttempt.count({
      where: { platform: input.platform, createdAt: { gt: new Date(now.getTime() - RATE_WINDOW_MS) } },
    });
    if (attempts >= platformLimit(input.platform))
      return {
        result: failure(
          "PUBLISH_PROCESSING",
          "Publishing capacity is temporarily full. We will retry shortly.",
          new Date(now.getTime() + STATUS_CHECK_INTERVAL_MS),
        ),
      };
    await tx.publishAttempt.create({
      data: { platform: input.platform, postId: input.postId, accountId: input.accountId, createdAt: now },
    });
    const count = checking ? attemptCount : attemptCount + 1;
    const startedAt = restarting ? now : (previous?.recoveryStartedAt ?? now);
    await tx.publishCheckpoint.upsert({
      where,
      create: {
        ...key,
        fingerprint: input.fingerprint,
        state: "started",
        recoveryProvider: input.recoveryProvider,
        leaseId,
        attemptCount: count,
        recoveryStartedAt: startedAt,
      },
      update: {
        fingerprint: input.fingerprint,
        recoveryProvider: input.recoveryProvider,
        leaseId,
        state: "started",
        nextAttemptAt: null,
        attemptCount: count,
        recoveryStartedAt: startedAt,
        ...(checking ? {} : { progress: Prisma.DbNull }),
      },
    });
    return { count, startedAt, job: checking ? job : undefined, checking };
  });
  if (claim.result) return claim.result;
  const count = claim.count!;
  let job = claim.job;
  const saveProgress = async (progress: TikTokVideoJob) => {
    job = { ...progress };
    const changed = await prisma.publishCheckpoint.updateMany({
      where: { ...key, fingerprint: input.fingerprint, state: "started", attemptCount: count, leaseId },
      data: { progress: sanitizeForJson(progress) as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) throw new Error("Publishing checkpoint ownership changed");
  };
  let result: PostingResult | undefined;
  try {
    if (!claim.checking && prepare) {
      try {
        await prepare();
      } catch {
        result = failure("PREPARATION_ERROR", "Media preparation failed.");
        result.recovery = { outcome: "not_published", retryable: true, phase: "prepare" };
      }
    }
    result = result ?? (await publish({ job, saveProgress }));
  } catch {
    result = failure("PUBLISH_OUTCOME_UNKNOWN", "Could not confirm the publishing result.");
    result.recovery = { outcome: "unknown", retryable: false, phase: "checkpoint" };
  }
  let state = result.success ? "succeeded" : "unknown";
  let nextAttemptAt: Date | null = null;
  const evidence = result.recovery;
  const providerJobId = job?.publishId;
  const knownRejected = [
    "PREPARATION_ERROR",
    "INVALID_CONTENT",
    "CREDENTIALS_ERROR",
    "RATE_LIMIT_ERROR",
    "PUBLISH_REJECTED",
  ].includes(result.error ?? "");
  if (!result.success && evidence?.outcome === "not_published") {
    state = "failed";
    // Conclusive rejection invalidates the old upload job; the next attempt initializes a new one.
    job = undefined;
    if (evidence.retryable && count < MAX_PUBLISH_ATTEMPTS) {
      state = "retry_wait";
      nextAttemptAt = new Date(Date.now() + retryDelay(count, evidence));
      result = {
        ...result,
        error: "PUBLISH_RETRY_SCHEDULED",
        message: `Retrying — attempt ${count + 1} of ${MAX_PUBLISH_ATTEMPTS}. ${result.message ?? ""}`,
        nextAttemptAt,
      };
    } else if (evidence.retryable) {
      result = {
        ...result,
        error: "PUBLISH_RETRY_EXHAUSTED",
        message: `Publishing failed after ${MAX_PUBLISH_ATTEMPTS} attempts. ${result.message ?? ""}`,
      };
    }
  } else if (!result.success && knownRejected && !evidence) {
    state = "failed";
  } else if (
    !result.success &&
    job &&
    ![401, 403].includes(evidence?.httpStatus ?? 0) &&
    Date.now() - claim.startedAt!.getTime() < RECOVERY_WINDOW_MS
  ) {
    state = "processing";
    nextAttemptAt = new Date(Date.now() + Math.max(STATUS_CHECK_INTERVAL_MS, evidence?.retryAfterMs ?? 0));
    result = {
      ...result,
      error: "PUBLISH_PROCESSING",
      message: "Processing on TikTok. We will check its status again.",
      nextAttemptAt,
    };
  } else if (!result.success) {
    result = {
      ...result,
      error: "PUBLISH_OUTCOME_UNKNOWN",
      message: [401, 403].includes(evidence?.httpStatus ?? 0)
        ? "Reconnect the TikTok account, then check its previous publishing outcome before retrying."
        : "Could not confirm the TikTok outcome. Check the account before retrying.",
    };
  }
  let changed: { count: number };
  try {
    changed = await prisma.publishCheckpoint.updateMany({
      where: { ...key, fingerprint: input.fingerprint, state: "started", attemptCount: count, leaseId },
      data: {
        state,
        nextAttemptAt,
        progress: job ? (sanitizeForJson(job) as Prisma.InputJsonValue) : Prisma.DbNull,
        result: sanitizeForJson({
          ...result,
          nextAttemptAt: nextAttemptAt?.toISOString(),
          extraData: result.platformData ? { platformData: result.platformData } : undefined,
        }) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // The database may have committed before its acknowledgement was lost. The saved
    // intent/job remains authoritative; a later run reuses success or checks the job.
    log.warn({ ...key, attempt: count }, "Could not persist publishing result; deferring checkpoint recovery");
    return failure(
      "PUBLISH_PROCESSING",
      "Checking TikTok publishing progress after an interruption.",
      new Date(Date.now() + STATUS_CHECK_INTERVAL_MS),
    );
  }
  if (changed.count !== 1) {
    // Return the winning worker's result rather than letting this stale caller
    // downgrade a completed publication to a failure at the post level.
    const current = await prisma.publishCheckpoint.findUnique({ where });
    if (
      current?.fingerprint === input.fingerprint &&
      ["succeeded", "failed", "unknown"].includes(current.state) &&
      current.result
    )
      return current.result as unknown as PostingResult;
    return failure(
      "PUBLISH_PROCESSING",
      "Publishing is being recovered by another worker.",
      current?.nextAttemptAt ?? new Date(Date.now() + STATUS_CHECK_INTERVAL_MS),
    );
  }
  log.info(
    {
      ...key,
      platform: input.platform,
      phase: evidence?.phase ?? job?.phase,
      providerJobId,
      httpStatus: evidence?.httpStatus,
      providerCode: evidence?.providerCode,
      attempt: count,
      decision: state,
      nextAttemptAt,
    },
    "Publishing recovery decision",
  );
  return result;
}
