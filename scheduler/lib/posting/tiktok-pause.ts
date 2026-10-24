import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { tikTokCapCode, tikTokRecovery, type TikTokCapCode } from "./tiktok-recovery";

/** Each explicitly scheduled recovery may probe at its own approved time,
 * even if an earlier retry in the same batch hit the cap again. */
export async function approveScheduledTikTokProbe(postId: string, accountIds: string[]) {
  await prisma.$transaction(async (tx) => {
    for (const accountId of [...accountIds].sort()) {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-upload-init:${accountId}`}, 0))::text`,
      );
      await tx.tikTokUploadPause.updateMany({ where: { accountId }, data: { resumeAt: new Date() } });
    }
    await tx.post.update({ where: { id: postId }, data: { tiktokRetryApproved: false } });
  });
}

export async function pauseTikTokUploads(accountId: string, code: TikTokCapCode) {
  const resumeAt = code === "rate_limit_exceeded" ? new Date(Date.now() + 60_000) : null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-upload-init:${accountId}`}, 0))::text`,
    );
    await tx.tikTokUploadPause.upsert({
      where: { accountId },
      create: { accountId, code, resumeAt },
      update: { code, resumeAt },
    });
  });
}

export async function resumeTikTokUploads(accountId: string, startedAt: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-upload-init:${accountId}`}, 0))::text`,
    );
    const deleted = await tx.tikTokUploadPause.deleteMany({ where: { accountId, updatedAt: { lte: startedAt } } });
    if (!deleted.count) return;
    // Recheck every affected post's other accounts on the next dispatch. Retain
    // original times and successful account results; never create replacement posts.
    await tx.post.updateMany({
      where: { status: "scheduled", accounts: { some: { id: accountId } }, tiktokPaused: true },
      data: { errorDetails: Prisma.DbNull, errorMessage: null, tiktokPaused: false },
    });
  });
}

export async function pausedTikTokResults(accountIds: string[]) {
  if (accountIds.length === 0) return [];
  const pauses = await prisma.tikTokUploadPause.findMany({
    where: { accountId: { in: accountIds }, OR: [{ resumeAt: null }, { resumeAt: { gt: new Date() } }] },
  });
  return pauses.flatMap((pause) => {
    const code = tikTokCapCode(pause.code);
    return code
      ? [
          {
            accountId: pause.accountId,
            platform: "tiktok",
            success: false,
            error: code === "rate_limit_exceeded" ? "LOCAL_RATE_LIMIT" : "TIKTOK_ACCOUNT_PAUSED",
            message: tikTokRecovery(code).message,
            details: { pauseCode: code, retryAt: pause.resumeAt?.toISOString() },
          },
        ]
      : [];
  });
}
