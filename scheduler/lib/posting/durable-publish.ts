import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";

export const RATE_WINDOW_MS = 60_000;
export const platformLimit = (platform: string) => (mapPlatformName(platform) === "forem" ? 10 : 15);

// Sorting keys makes an equivalent API payload stable across serialization.
export function publishFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map((entry) => canonical(entry));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

interface PublishIdentity {
  postId: string;
  accountId: string;
  platform: string;
  operation: "post" | "repost";
  segment: number;
  fingerprint: string;
}

const UNKNOWN_MESSAGE =
  "The previous publish may have reached the platform. Check the account and reconcile its result before retrying this post.";

function failure(input: PublishIdentity, error: string, message: string): PostingResult {
  return { accountId: input.accountId, platform: input.platform, success: false, error, message };
}

/** Atomic budget reservation + durable intent, shared by every scheduler process. */
export async function runDurablePublish(
  input: PublishIdentity,
  publish: () => Promise<PostingResult>,
  prepare?: () => Promise<void>,
): Promise<PostingResult> {
  const platform = mapPlatformName(input.platform);
  const key = { postId: input.postId, accountId: input.accountId, operation: input.operation, segment: input.segment };
  const where = { postId_accountId_operation_segment: key };
  if (prepare) {
    const previous = await prisma.publishCheckpoint.findUnique({ where });
    if (previous?.fingerprint === input.fingerprint && previous.state === "succeeded")
      return previous.result as unknown as PostingResult;
    // Media resolution has no publishing side effects. Do it before intent, so
    // a download failure remains safely retryable and a cached root needs no media.
    try {
      await prepare();
    } catch {
      // Do not replace another worker's intent or success if preparation raced it.
      await prisma.publishCheckpoint.upsert({
        where,
        create: { ...key, fingerprint: input.fingerprint, state: "failed" },
        update: {},
      });
      return failure(input, "PREPARATION_ERROR", "Media preparation failed. Check the media and retry this post.");
    }
  }
  const cached = await prisma.$transaction(async (tx) => {
    // Provider lock serializes both the sliding-window count and checkpoint claim.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`publish:${platform}`}, 0))::text`);
    const previous = await tx.publishCheckpoint.findUnique({ where });
    if (previous) {
      if (previous.state !== "failed" && previous.fingerprint !== input.fingerprint)
        return failure(
          input,
          "PUBLISH_CONTENT_CHANGED",
          "This post has publishing progress for different content. Restore the original content to resume, or explicitly duplicate it as a new post.",
        );
      if (previous.state === "succeeded") return previous.result as unknown as PostingResult;
      if (previous.state !== "failed") return failure(input, "PUBLISH_OUTCOME_UNKNOWN", UNKNOWN_MESSAGE);
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
    const attempts = await tx.publishAttempt.count({
      where: { platform, createdAt: { gt: new Date(now.getTime() - RATE_WINDOW_MS) } },
    });
    if (attempts >= platformLimit(platform))
      return failure(
        input,
        "LOCAL_RATE_LIMIT",
        "Publishing capacity is temporarily full. Retry after one minute; completed segments will be reused.",
      );
    await tx.publishAttempt.create({
      data: { platform, postId: input.postId, accountId: input.accountId, createdAt: now },
    });
    await tx.publishCheckpoint.upsert({
      where,
      create: { ...key, fingerprint: input.fingerprint, state: "started" },
      update: { state: "started", fingerprint: input.fingerprint, result: Prisma.DbNull },
    });
    return null;
  });
  if (cached) return cached;

  let result: PostingResult;
  try {
    result = await publish();
  } catch {
    // Intent remains durable even if the provider or database connection drops.
    return failure(input, "PUBLISH_OUTCOME_UNKNOWN", UNKNOWN_MESSAGE);
  }
  // Only these SDK errors conclusively reject a publish. API/transport errors
  // can occur after acceptance, especially on multipart and threaded providers.
  const safeToRetry = ["INVALID_CONTENT", "CREDENTIALS_ERROR", "RATE_LIMIT_ERROR"].includes(result.error ?? "");
  const state = result.success ? "succeeded" : safeToRetry ? "failed" : "unknown";
  const persisted = { ...result, extraData: result.platformData ? { platformData: result.platformData } : undefined };
  await prisma.publishCheckpoint.update({
    where,
    data: { state, result: sanitizeForJson(persisted) as Prisma.InputJsonValue },
  });
  return state === "unknown"
    ? {
        ...result,
        error: "PUBLISH_OUTCOME_UNKNOWN",
        message: `${result.message ?? result.error ?? "Publish failed"} ${UNKNOWN_MESSAGE}`,
      }
    : result;
}
