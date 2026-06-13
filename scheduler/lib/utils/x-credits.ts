import { createLogger } from "@/lib/logger";
import type { PostingResult } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { BadRequestError } from "@/lib/utils/errors";

const log = createLogger("x-credits");

function isXPlatform(platform: string): boolean {
  const lower = platform.toLowerCase();
  return lower === "x" || lower === "twitter";
}

export async function getXCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { xPostingCredits: true },
  });
  return user.xPostingCredits;
}

async function countXAccounts(userId: string, accountIds: string[]): Promise<number> {
  if (accountIds.length === 0) return 0;
  return prisma.connectedAccount.count({
    where: { id: { in: accountIds }, userId, platform: "x" },
  });
}

export async function checkAndDeductXCredits(userId: string, accountIds: string[]): Promise<void> {
  const xAccountCount = await countXAccounts(userId, accountIds);

  if (xAccountCount === 0) return;

  // Conditional decrement: the balance check and the deduction must be one
  // atomic statement, otherwise two concurrent requests can both pass a
  // read-then-update check and drive the balance negative.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, xPostingCredits: { gte: xAccountCount } },
    data: { xPostingCredits: { decrement: xAccountCount } },
  });

  if (count === 0) {
    const balance = await getXCredits(userId);
    throw new BadRequestError(
      balance === 0
        ? "You have no X posting credits remaining."
        : `You need ${xAccountCount} X posting credit${xAccountCount > 1 ? "s" : ""} but only have ${balance} remaining.`,
    );
  }
}

export async function refundXCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;

  await prisma.user.update({
    where: { id: userId },
    data: { xPostingCredits: { increment: amount } },
  });
  log.info({ userId, amount }, "Refunded X posting credits");
}

/**
 * Refunds credits for X accounts whose publish failed without anything going
 * out (no root post id). A partially posted thread keeps its charge — the
 * root tweet was published.
 */
export async function refundXCreditsForFailedResults(userId: string, results: PostingResult[]): Promise<void> {
  const failedXCount = results.filter(
    (result) => isXPlatform(result.platform) && !result.success && !result.postId,
  ).length;

  try {
    await refundXCredits(userId, failedXCount);
  } catch (error) {
    // A refund failure must not mask the publish error the caller is handling.
    log.error({ userId, failedXCount, err: error }, "Failed to refund X credits");
  }
}

/**
 * Refunds credits for all X accounts in the given list. Used when a publish
 * attempt throws before producing per-account results.
 */
export async function refundXCreditsForAccountIds(userId: string, accountIds: string[]): Promise<void> {
  const xAccountCount = await countXAccounts(userId, accountIds);
  try {
    await refundXCredits(userId, xAccountCount);
  } catch (error) {
    log.error({ userId, xAccountCount, err: error }, "Failed to refund X credits");
  }
}

/**
 * Refunds credits for the X accounts of a scheduled post that is discarded
 * before publishing. Drafts never had credits deducted and published/failed
 * posts have already spent or been refunded theirs.
 */
export async function refundXCreditsForDiscardedPost(
  userId: string,
  post: { status: string; accountIds: string[] },
): Promise<void> {
  if (post.status !== "scheduled") return;
  await refundXCreditsForAccountIds(userId, post.accountIds);
}
