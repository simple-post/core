import { Prisma } from "@prisma/client";
import { PostError, PostErrorType } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 6;

/** Reserve immediately before I/O; every scheduler process shares this budget. */
export async function reserveTikTokUploadInit(accountId: string): Promise<void> {
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-upload-init:${accountId}`}, 0))::text`,
    );
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
    const pause = await tx.tikTokUploadPause.findUnique({ where: { accountId } });
    if (pause && (!pause.resumeAt || pause.resumeAt > now)) {
      throw new PostError(
        PostErrorType.RATE_LIMIT_ERROR,
        "TikTok uploads for this account are paused. Schedule another attempt later.",
        {
          phase: "init",
          localAccountPause: pause.code !== "rate_limit_exceeded",
          localRateLimit: pause.code === "rate_limit_exceeded",
          pauseCode: pause.code,
          retryAt: pause.resumeAt?.toISOString(),
        },
      );
    }
    const count = await tx.tikTokUploadInitAttempt.count({
      where: { accountId, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
    });
    if (count >= MAX_REQUESTS) return false;
    if (pause && pause.code !== "rate_limit_exceeded") {
      // A user-approved time permits one probe. Other workers wait until it
      // succeeds, rather than releasing an entire backlog into the same cap.
      await tx.tikTokUploadPause.update({ where: { accountId }, data: { resumeAt: null, updatedAt: pause.updatedAt } });
    }
    await tx.tikTokUploadInitAttempt.create({ data: { accountId, createdAt: now } });
    return true;
  });
  if (!reserved) {
    throw new PostError(
      PostErrorType.RATE_LIMIT_ERROR,
      "This TikTok account has reached its upload request limit (6 requests per minute). Retry after one minute; scheduled posts will be deferred automatically.",
      { phase: "init", localRateLimit: true },
    );
  }
}
