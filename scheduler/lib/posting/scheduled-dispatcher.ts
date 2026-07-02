import { Prisma } from "@prisma/client";
import { isThreadCapable } from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { createLogger } from "@/lib/logger";
import { postToAccounts, getPostingSummary, repostToAccounts } from "@/lib/posting";
import { getSucceededAccountIds, mergeAccountResults } from "@/lib/posting/account-results";
import { prisma } from "@/lib/prisma";
import { summarizeRepostOutcome } from "@/lib/repost/results";
import { buildPublishedRepostState } from "@/lib/repost/settings";
import { buildRepostTargets } from "@/lib/repost/targets";
import { sanitizeForJson } from "@/lib/utils/errors";
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
  repostEnabled: boolean;
  repostDelayHours: number;
  media: MediaFile[];
  accounts: Array<{
    id: string;
    platform: string;
  }>;
}

interface DueRepostPost {
  id: string;
  userId: string;
  message: string;
  accountOptions: unknown;
  accountResults: unknown;
  repostDelayHours: number;
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
  processedReposts: number;
  completedReposts: number;
  failedReposts: number;
  skippedReposts: number;
  staleRecoveredReposts: number;
  platformSummary: DispatchPlatformSummary[];
  postResults: DispatchPostResult[];
  repostResults: DispatchPostResult[];
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

async function recoverStalePendingReposts(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);
  const errorMessage = "Reposting was interrupted before completion. Use the repost action to try again.";

  const stalePosts = await prisma.post.findMany({
    where: {
      repostStatus: "pending",
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });

  if (stalePosts.length === 0) {
    return 0;
  }

  const { count } = await prisma.post.updateMany({
    where: { id: { in: stalePosts.map((post) => post.id) }, repostStatus: "pending" },
    data: {
      repostStatus: "failed",
      repostErrorMessage: errorMessage,
    },
  });

  log.warn({ count, staleMinutes: STALE_PENDING_MINUTES }, "Recovered stale pending reposts");
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

async function claimReposts(posts: DueRepostPost[]): Promise<DueRepostPost[]> {
  const claimed: DueRepostPost[] = [];

  for (const post of posts) {
    const { count } = await prisma.post.updateMany({
      where: { id: post.id, repostStatus: "scheduled" },
      data: { repostStatus: "pending" },
    });

    if (count === 1) {
      claimed.push(post);
    } else {
      log.info({ postId: post.id }, "Repost no longer claimable — skipping");
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
      OR: [{ publishedAt: { gte: windowStart } }, { repostedAt: { gte: windowStart } }],
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
    const publishedAt = new Date();
    const repostState = buildPublishedRepostState({
      enabled: post.repostEnabled,
      delayHours: post.repostDelayHours,
      accountResults: previousResults,
      publishedAt,
    });
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "published",
        publishedAt,
        errorMessage: null,
        errorDetails: Prisma.DbNull,
        repostDueAt: repostState.repostDueAt,
        repostStatus: repostState.repostStatus,
        repostResults: Prisma.DbNull,
        repostErrorMessage: null,
        repostErrorDetails: Prisma.DbNull,
      },
    });
    await dispatchPostWebhooks(post.userId, "post.published", {
      id: post.id,
      status: "published",
      message: post.message,
      publishedAt: publishedAt.toISOString(),
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
      const publishedAt = new Date();
      const repostState = buildPublishedRepostState({
        enabled: post.repostEnabled,
        delayHours: post.repostDelayHours,
        accountResults,
        publishedAt,
      });
      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "published",
          publishedAt,
          errorMessage: null,
          errorDetails: Prisma.DbNull,
          accountResults: sanitizedAccountResults,
          threadResults: hasThreadResults
            ? (sanitizeForJson(threadResultsByAccount) as Prisma.InputJsonValue)
            : Prisma.DbNull,
          repostDueAt: repostState.repostDueAt,
          repostStatus: repostState.repostStatus,
          repostResults: Prisma.DbNull,
          repostErrorMessage: null,
          repostErrorDetails: Prisma.DbNull,
        },
      });

      await dispatchPostWebhooks(post.userId, "post.published", {
        id: post.id,
        status: "published",
        message: post.message,
        publishedAt: publishedAt.toISOString(),
        accountResults,
      });

      return {
        postId: post.id,
        success: true,
        status: "published",
      };
    }

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
        repostDueAt: null,
        repostStatus: "not_applicable",
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

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "failed",
        errorMessage,
        errorDetails: sanitizeForJson({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }) as Prisma.InputJsonValue,
        repostDueAt: null,
        repostStatus: "not_applicable",
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

async function dispatchAutoRepost(post: DueRepostPost): Promise<DispatchPostResult> {
  const targets = buildRepostTargets(post);

  if (targets.length === 0) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        repostStatus: "not_applicable",
        repostDueAt: null,
        repostErrorMessage: null,
        repostErrorDetails: Prisma.DbNull,
      },
    });
    return { postId: post.id, success: true, status: "published" };
  }

  try {
    await assertActiveSubscription(post.userId);

    const results = await repostToAccounts(
      post.userId,
      targets,
      (post.accountOptions as AccountOptionsMap | null) ?? undefined,
    );
    const outcome = summarizeRepostOutcome(results);
    const repostResults = outcome.repostResults as unknown as Prisma.InputJsonValue;

    if (outcome.summary.overallSuccess) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          repostStatus: "completed",
          repostedAt: new Date(),
          repostResults,
          repostErrorMessage: null,
          repostErrorDetails: Prisma.DbNull,
        },
      });

      return { postId: post.id, success: true, status: "published" };
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        repostStatus: "failed",
        repostResults,
        repostErrorMessage: outcome.errorMessage,
        repostErrorDetails: (outcome.errorDetails ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });

    return { postId: post.id, success: false, status: "failed", errorMessage: outcome.errorMessage ?? undefined };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error while reposting";

    await prisma.post.update({
      where: { id: post.id },
      data: {
        repostStatus: "failed",
        repostErrorMessage: errorMessage,
        repostErrorDetails: sanitizeForJson({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }) as Prisma.InputJsonValue,
      },
    });

    return { postId: post.id, success: false, status: "failed", errorMessage };
  }
}

export async function dispatchDueScheduledPosts(): Promise<DispatchDuePostsResult> {
  const startedAt = new Date();
  const now = new Date();

  const [staleRecoveredPosts, staleRecoveredReposts] = await Promise.all([
    recoverStalePendingPosts(),
    recoverStalePendingReposts(),
  ]);

  const [duePosts, dueReposts] = (await Promise.all([
    prisma.post.findMany({
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
    }),
    prisma.post.findMany({
      where: {
        status: "published",
        repostStatus: "scheduled",
        repostDueAt: {
          lte: now,
        },
      },
      include: {
        accounts: {
          select: {
            id: true,
            platform: true,
          },
        },
      },
      orderBy: {
        repostDueAt: "asc",
      },
      take: MAX_POSTS_PER_RUN,
    }),
  ])) as [DuePost[], DueRepostPost[]];

  const repostTargetsByPostId = new Map(dueReposts.map((post) => [post.id, buildRepostTargets(post)]));

  if (duePosts.length === 0 && dueReposts.length === 0) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      processedPosts: 0,
      publishedPosts: 0,
      failedPosts: 0,
      skippedPosts: 0,
      staleRecoveredPosts,
      processedReposts: 0,
      completedReposts: 0,
      failedReposts: 0,
      skippedReposts: 0,
      staleRecoveredReposts,
      platformSummary: [],
      postResults: [],
      repostResults: [],
    };
  }

  const uniquePlatforms = [
    ...new Set<string>([
      ...duePosts.flatMap((post) => post.accounts.map((account) => account.platform.toLowerCase())),
      ...dueReposts.flatMap((post) => {
        const accountById = new Map(post.accounts.map((account) => [account.id, account.platform.toLowerCase()]));
        return (repostTargetsByPostId.get(post.id) ?? [])
          .map((target) => accountById.get(target.accountId))
          .filter((platform): platform is string => typeof platform === "string");
      }),
    ]),
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
  const repostsToProcess: DueRepostPost[] = [];
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

  for (const post of dueReposts) {
    const targets = repostTargetsByPostId.get(post.id) ?? [];
    const accountById = new Map(post.accounts.map((account) => [account.id, account.platform.toLowerCase()]));
    const costs = new Map<string, number>();

    for (const target of targets) {
      const platform = accountById.get(target.accountId);
      if (platform) {
        costs.set(platform, (costs.get(platform) ?? 0) + 1);
      }
    }

    // No billable targets (e.g. the only repost-capable account lost its
    // publish result): enqueue so dispatchAutoRepost can settle it to
    // "not_applicable" without consuming any rate-limit budget. Every real
    // target maps to an account in post.accounts, so a non-empty target set
    // always produces costs above.
    if (costs.size === 0) {
      repostsToProcess.push(post);
      continue;
    }

    const canSend = [...costs].every(([platform, cost]) => {
      const budget = platformBudgets.get(platform);
      return !!budget && budget.availableSlots - budget.sent >= cost;
    });

    if (!canSend) {
      for (const [platform, cost] of costs) {
        const budget = platformBudgets.get(platform);
        if (!budget || budget.availableSlots - budget.sent < cost) {
          skippedByPlatform.set(platform, (skippedByPlatform.get(platform) ?? 0) + 1);
        }
      }
      continue;
    }

    repostsToProcess.push(post);
    for (const [platform, cost] of costs) {
      const budget = platformBudgets.get(platform);
      if (budget) {
        budget.sent += cost;
      }
    }
  }

  const claimedPosts = await claimPosts(postsToProcess);
  const claimedReposts = await claimReposts(repostsToProcess);

  const [postResults, repostResults] = await Promise.all([
    Promise.all(claimedPosts.map((post) => publishScheduledPost(post))),
    Promise.all(claimedReposts.map((post) => dispatchAutoRepost(post))),
  ]);

  const publishedPosts = postResults.filter((result) => result.status === "published").length;
  const failedPosts = postResults.filter((result) => result.status === "failed").length;
  const completedReposts = repostResults.filter((result) => result.success).length;
  const failedReposts = repostResults.filter((result) => !result.success).length;

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
      dueReposts: dueReposts.length,
      processedPosts: claimedPosts.length,
      processedReposts: claimedReposts.length,
      skippedPosts: duePosts.length - claimedPosts.length,
      skippedReposts: dueReposts.length - claimedReposts.length,
      staleRecoveredPosts,
      staleRecoveredReposts,
      publishedPosts,
      failedPosts,
      completedReposts,
      failedReposts,
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
    processedReposts: claimedReposts.length,
    completedReposts,
    failedReposts,
    skippedReposts: dueReposts.length - claimedReposts.length,
    staleRecoveredReposts,
    platformSummary,
    postResults,
    repostResults,
  };
}
