import { Prisma } from "@prisma/client";
import { isThreadCapable } from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { createLogger } from "@/lib/logger";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { getSucceededAccountIds, mergeAccountResults } from "@/lib/posting/account-results";
import { prisma } from "@/lib/prisma";
import { sanitizeForJson } from "@/lib/utils/errors";
import { refundXCreditsForAccountIds, refundXCreditsForFailedResults } from "@/lib/utils/x-credits";
import { dispatchPostWebhooks } from "@/lib/webhooks";
import type { AccountOptionsMap, AccountOverridesMap, AccountResultsMap, MediaFile } from "@/types";

import type { ThreadSegment } from "@simple-post/sdk";

const log = createLogger("scheduled-dispatcher");

const MAX_POSTS_PER_RUN = 100;

// A post stuck in "pending" longer than this is considered abandoned (the
// process that claimed it crashed or was killed mid-publish) and is failed
// out so the user sees an actionable error instead of a silently stuck post.
// Must comfortably exceed the longest legitimate publish (large video uploads
// can run several minutes per platform).
const STALE_PENDING_MINUTES = 30;

const DEFAULT_RATE_LIMIT: PlatformRateLimit = {
  maxPosts: 15,
  intervalMinutes: 1,
};

const PLATFORM_RATE_LIMITS: Record<string, PlatformRateLimit> = {
  x: { maxPosts: 15, intervalMinutes: 1 },
  twitter: { maxPosts: 15, intervalMinutes: 1 },
  instagram: { maxPosts: 15, intervalMinutes: 1 },
  facebook: { maxPosts: 15, intervalMinutes: 1 },
  youtube: { maxPosts: 15, intervalMinutes: 1 },
  tiktok: { maxPosts: 15, intervalMinutes: 1 },
  threads: { maxPosts: 15, intervalMinutes: 1 },
  linkedin: { maxPosts: 15, intervalMinutes: 1 },
  bluesky: { maxPosts: 15, intervalMinutes: 1 },
  pinterest: { maxPosts: 15, intervalMinutes: 1 },
  telegram: { maxPosts: 15, intervalMinutes: 1 },
};

interface PlatformRateLimit {
  maxPosts: number;
  intervalMinutes: number;
}

interface DispatchPlatformSummary {
  platform: string;
  sent: number;
  availableSlots: number;
  queued: number;
  rateLimit: PlatformRateLimit;
}

interface DispatchPostResult {
  postId: string;
  success: boolean;
  status: "published" | "failed";
  errorMessage?: string;
}

interface DuePost {
  id: string;
  userId: string;
  message: string;
  accountOptions: unknown;
  accountOverrides: unknown;
  thread: ThreadSegment[] | null;
  accountResults: unknown;
  media: MediaFile[];
  accounts: Array<{
    id: string;
    platform: string;
  }>;
}

export interface DispatchDuePostsResult {
  startedAt: string;
  finishedAt: string;
  processedPosts: number;
  publishedPosts: number;
  failedPosts: number;
  skippedPosts: number;
  staleRecoveredPosts: number;
  platformSummary: DispatchPlatformSummary[];
  postResults: DispatchPostResult[];
}

/**
 * Fails out posts stuck in "pending" (claimed by a dispatch run or an
 * immediate-post request that died before recording a result). Without this
 * sweep such posts are invisible to the dispatcher forever.
 */
async function recoverStalePendingPosts(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);
  const errorMessage = "Publishing was interrupted before completion. Reschedule the post to try again.";

  const stalePosts = await prisma.post.findMany({
    where: {
      status: "pending",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, userId: true, message: true },
  });

  if (stalePosts.length === 0) {
    return 0;
  }

  const { count } = await prisma.post.updateMany({
    where: { id: { in: stalePosts.map((post) => post.id) }, status: "pending" },
    data: {
      status: "failed",
      errorMessage,
    },
  });

  log.warn({ count, staleMinutes: STALE_PENDING_MINUTES }, "Recovered stale pending posts");

  await Promise.all(
    stalePosts.map((post) =>
      dispatchPostWebhooks(post.userId, "post.failed", {
        id: post.id,
        status: "failed",
        message: post.message,
        errorMessage,
      }),
    ),
  );

  return count;
}

/**
 * Atomically claims posts for this dispatch run by flipping them from
 * "scheduled" to "pending". A post whose status already changed (claimed by a
 * concurrent run, or edited by the user) is filtered out, which makes
 * overlapping dispatch runs safe: each due post is published at most once.
 */
async function claimPosts(posts: DuePost[]): Promise<DuePost[]> {
  const claimed: DuePost[] = [];

  for (const post of posts) {
    const { count } = await prisma.post.updateMany({
      where: { id: post.id, status: "scheduled" },
      data: { status: "pending" },
    });

    if (count === 1) {
      claimed.push(post);
    } else {
      log.info({ postId: post.id }, "Post no longer claimable — skipping (claimed elsewhere or edited)");
    }
  }

  return claimed;
}

function getRateLimit(platform: string): PlatformRateLimit {
  return PLATFORM_RATE_LIMITS[platform.toLowerCase()] ?? DEFAULT_RATE_LIMIT;
}

async function getSentCountForPlatform(platform: string, intervalMinutes: number): Promise<number> {
  const windowStart = new Date(Date.now() - intervalMinutes * 60 * 1000);

  return await prisma.post.count({
    where: {
      status: "published",
      publishedAt: {
        gte: windowStart,
      },
      accounts: {
        some: {
          platform,
        },
      },
    },
  });
}

async function publishScheduledPost(post: DuePost): Promise<DispatchPostResult> {
  const previousResults = (post.accountResults as AccountResultsMap | null) ?? undefined;
  const succeededAccountIds = getSucceededAccountIds(previousResults);

  // A retried post (rescheduled after a partial failure) only publishes to
  // the accounts that have no recorded success — never double-post.
  const accountIds = post.accounts.map((account) => account.id).filter((id) => !succeededAccountIds.has(id));

  if (succeededAccountIds.size > 0) {
    log.info(
      { postId: post.id, skippedAccounts: [...succeededAccountIds], remainingAccounts: accountIds },
      "Skipping accounts that already published successfully",
    );
  }

  if (accountIds.length === 0) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        errorMessage: null,
        errorDetails: Prisma.DbNull,
      },
    });
    await dispatchPostWebhooks(post.userId, "post.published", {
      id: post.id,
      status: "published",
      message: post.message,
      publishedAt: new Date().toISOString(),
      accountResults: previousResults,
    });

    return { postId: post.id, success: true, status: "published" };
  }

  try {
    await assertActiveSubscription(post.userId);

    const postingResults = await postToAccounts(
      post.userId,
      post.message,
      post.media,
      accountIds,
      (post.accountOptions as AccountOptionsMap | null) ?? undefined,
      (post.accountOverrides as AccountOverridesMap | null) ?? undefined,
      post.thread ?? undefined,
    );

    const summary = getPostingSummary(postingResults);
    const accountResults = mergeAccountResults(previousResults, postingResults);
    const sanitizedAccountResults = sanitizeForJson(accountResults) as Prisma.InputJsonValue;

    // Build accountId → ThreadSegmentResult[] map for accounts that posted as a thread.
    const threadResultsByAccount = postingResults.reduce<Record<string, unknown>>((acc, result) => {
      if (result.threadResults) acc[result.accountId] = result.threadResults;
      return acc;
    }, {});
    const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;

    if (summary.overallSuccess) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "published",
          publishedAt: new Date(),
          errorMessage: null,
          errorDetails: Prisma.DbNull,
          accountResults: sanitizedAccountResults,
          threadResults: hasThreadResults
            ? (sanitizeForJson(threadResultsByAccount) as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });

      await dispatchPostWebhooks(post.userId, "post.published", {
        id: post.id,
        status: "published",
        message: post.message,
        publishedAt: new Date().toISOString(),
        accountResults,
      });

      return {
        postId: post.id,
        success: true,
        status: "published",
      };
    }

    await refundXCreditsForFailedResults(post.userId, postingResults);

    const failedResults = postingResults.filter((result) => !result.success);
    const errorMessage =
      failedResults.length === 1
        ? failedResults[0].message || failedResults[0].error || "Unknown error"
        : `Failed on ${failedResults.length} platform(s)`;

    const errorDetails = sanitizeForJson({
      failedPlatforms: failedResults.map((result) => ({
        accountId: result.accountId,
        platform: result.platform,
        error: result.error,
        message: result.message,
        details: result.details,
        threadResults: result.threadResults,
      })),
    }) as Prisma.InputJsonValue;

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "failed",
        errorMessage,
        errorDetails,
        accountResults: sanitizedAccountResults,
        threadResults: hasThreadResults
          ? (sanitizeForJson(threadResultsByAccount) as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });

    await dispatchPostWebhooks(post.userId, "post.failed", {
      id: post.id,
      status: "failed",
      message: post.message,
      errorMessage,
      accountResults,
    });

    return {
      postId: post.id,
      success: false,
      status: "failed",
      errorMessage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error while publishing scheduled post";

    await refundXCreditsForAccountIds(post.userId, accountIds);

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "failed",
        errorMessage,
        errorDetails: sanitizeForJson({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }) as Prisma.InputJsonValue,
      },
    });

    await dispatchPostWebhooks(post.userId, "post.failed", {
      id: post.id,
      status: "failed",
      message: post.message,
      errorMessage,
    });

    return {
      postId: post.id,
      success: false,
      status: "failed",
      errorMessage,
    };
  }
}

export async function dispatchDueScheduledPosts(): Promise<DispatchDuePostsResult> {
  const startedAt = new Date();
  const now = new Date();

  const staleRecoveredPosts = await recoverStalePendingPosts();

  const duePosts = (await prisma.post.findMany({
    where: {
      status: "scheduled",
      scheduledFor: {
        lte: now,
      },
    },
    include: {
      media: true,
      accounts: {
        select: {
          id: true,
          platform: true,
        },
      },
    },
    orderBy: {
      scheduledFor: "asc",
    },
    take: MAX_POSTS_PER_RUN,
  })) as DuePost[];

  if (duePosts.length === 0) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      processedPosts: 0,
      publishedPosts: 0,
      failedPosts: 0,
      skippedPosts: 0,
      staleRecoveredPosts,
      platformSummary: [],
      postResults: [],
    };
  }

  const uniquePlatforms = [
    ...new Set<string>(duePosts.flatMap((post) => post.accounts.map((account) => account.platform.toLowerCase()))),
  ];

  const platformBudgets = new Map<string, { sent: number; availableSlots: number; rateLimit: PlatformRateLimit }>();

  await Promise.all(
    uniquePlatforms.map(async (platform) => {
      const rateLimit = getRateLimit(platform);
      const alreadySent = await getSentCountForPlatform(platform, rateLimit.intervalMinutes);
      const availableSlots = Math.max(0, rateLimit.maxPosts - alreadySent);

      platformBudgets.set(platform, {
        sent: 0,
        availableSlots,
        rateLimit,
      });
    }),
  );

  const postsToProcess: DuePost[] = [];
  const skippedByPlatform = new Map<string, number>();

  for (const post of duePosts) {
    const platforms = [...new Set(post.accounts.map((account) => account.platform.toLowerCase()))];

    // Per-platform cost: thread-capable platforms post N segments;
    // non-capable platforms always post just the root.
    const threadSegmentCount = post.thread?.length ?? 0;
    const costFor = (platform: string) => (isThreadCapable(mapPlatformName(platform)) ? 1 + threadSegmentCount : 1);

    const canSend = platforms.every((platform) => {
      const budget = platformBudgets.get(platform);
      return !!budget && budget.availableSlots - budget.sent >= costFor(platform);
    });

    if (!canSend) {
      for (const platform of platforms) {
        const budget = platformBudgets.get(platform);
        if (!budget || budget.availableSlots - budget.sent < costFor(platform)) {
          skippedByPlatform.set(platform, (skippedByPlatform.get(platform) ?? 0) + 1);
        }
      }
      continue;
    }

    postsToProcess.push(post);
    for (const platform of platforms) {
      const budget = platformBudgets.get(platform);
      if (budget) {
        budget.sent += costFor(platform);
      }
    }
  }

  const claimedPosts = await claimPosts(postsToProcess);

  const postResults = await Promise.all(claimedPosts.map((post) => publishScheduledPost(post)));

  const publishedPosts = postResults.filter((result) => result.status === "published").length;
  const failedPosts = postResults.filter((result) => result.status === "failed").length;

  const platformSummary: DispatchPlatformSummary[] = uniquePlatforms
    .map((platform) => {
      const budget = platformBudgets.get(platform);
      if (!budget) {
        return null;
      }

      return {
        platform,
        sent: budget.sent,
        availableSlots: budget.availableSlots,
        queued: skippedByPlatform.get(platform) ?? 0,
        rateLimit: budget.rateLimit,
      };
    })
    .filter((value): value is DispatchPlatformSummary => value !== null)
    .sort((left, right) => left.platform.localeCompare(right.platform));

  const finishedAt = new Date();

  log.info(
    {
      duePosts: duePosts.length,
      processedPosts: claimedPosts.length,
      skippedPosts: duePosts.length - claimedPosts.length,
      staleRecoveredPosts,
      publishedPosts,
      failedPosts,
      platformSummary,
    },
    "Scheduled posts dispatch completed",
  );

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    processedPosts: claimedPosts.length,
    publishedPosts,
    failedPosts,
    skippedPosts: duePosts.length - claimedPosts.length,
    staleRecoveredPosts,
    platformSummary,
    postResults,
  };
}
