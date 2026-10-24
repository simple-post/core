import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { tikTokCapCode, tikTokRecovery, type TikTokCapCode } from "./tiktok-recovery";

export async function pauseTikTokUploads(accountId: string, code: TikTokCapCode) {
  const resumeAt = code === "rate_limit_exceeded" ? new Date(Date.now() + 60_000) : null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-upload-init:${accountId}`}, 0))::text`,
    );
    const existing = await tx.tikTokUploadPause.findUnique({ where: { accountId } });
    // A late minute-limit response must not release a longer account pause.
    if (code === "rate_limit_exceeded" && existing && existing.code !== code) return;
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

export async function pausedTikTokResults(accountIds: string[], retryApproved = false) {
  if (accountIds.length === 0) return [];
  const pauses = await prisma.tikTokUploadPause.findMany({
    where: { accountId: { in: accountIds }, OR: [{ resumeAt: null }, { resumeAt: { gt: new Date() } }] },
  });
  return pauses.flatMap((pause) => {
    // Approval belongs to the dispatched post, never to another waiting post.
    if (retryApproved && pause.code !== "rate_limit_exceeded") return [];
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
