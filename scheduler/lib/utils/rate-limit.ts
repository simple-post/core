import { getPlatformById } from "@/lib/config";
import { PLATFORM_RATE_LIMITS } from "@/lib/config/rate-limits";
import { prisma } from "@/lib/prisma";
import { RateLimitError } from "@/lib/utils/errors";

const WINDOW_HOURS = 24;

export interface PlatformRateLimitStatus {
  platform: string;
  platformName: string;
  postsToday: number;
  maxPerDay: number;
  isAtLimit: boolean;
}

async function getPlatformsForAccounts(userId: string, accountIds: string[]): Promise<string[]> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { id: { in: accountIds }, userId },
    select: { platform: true },
  });
  return [...new Set(accounts.map((a) => a.platform))];
}

export async function getRateLimitStatuses(
  userId: string,
  accountIds: string[],
): Promise<PlatformRateLimitStatus[]> {
  const platforms = await getPlatformsForAccounts(userId, accountIds);
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const statuses = await Promise.all(
    platforms.map(async (platform) => {
      const limit = PLATFORM_RATE_LIMITS[platform];
      if (!limit) return null;

      const postsToday = await prisma.post.count({
        where: {
          userId,
          createdAt: { gte: windowStart },
          status: { notIn: ["failed"] },
          accounts: { some: { platform } },
        },
      });

      return {
        platform,
        platformName: getPlatformById(platform)?.name ?? platform,
        postsToday,
        maxPerDay: limit.maxPostsPerDay,
        isAtLimit: postsToday >= limit.maxPostsPerDay,
      } satisfies PlatformRateLimitStatus;
    }),
  );

  return statuses.filter((s): s is PlatformRateLimitStatus => s !== null);
}

export async function checkRateLimits(userId: string, accountIds: string[]): Promise<void> {
  const statuses = await getRateLimitStatuses(userId, accountIds);
  for (const status of statuses) {
    if (status.isAtLimit) {
      throw new RateLimitError(
        `You've reached the daily posting limit for ${status.platformName}. Please try again later.`,
      );
    }
  }
}
