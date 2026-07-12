import { Prisma } from "@prisma/client";
import { isThreadCapable } from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { createLogger } from "@/lib/logger";
import { refreshExpiringConnectedAccounts } from "@/lib/oauth/credential-health";
import { postToAccounts, getPostingSummary, repostToAccounts } from "@/lib/posting";
import { getSucceededAccountIds, mergeAccountResults } from "@/lib/posting/account-results";
import { prisma } from "@/lib/prisma";
import { buildQuoteTargets, hasSuccessfulQuoteSourceResult } from "@/lib/quote/targets";
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
  discord: { maxPosts: 30, intervalMinutes: 1 },
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
  quotePostId: string | null;
  quotePost: { status: string } | null;
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

/**
 * Keeps the database's scheduled-time order while ensuring a due source is
 * always handled before another due post that quotes it. The validation layer
 * prevents cycles; if corrupted data contains one, the remaining posts retain
 * their original order and are deferred by the dependency checks below.
 */
function orderPostsByQuoteDependencies(posts: DuePost[]): DuePost[] {
  const remaining = [...posts];
  const remainingIds = new Set(remaining.map((post) => post.id));
  const ordered: DuePost[] = [];

  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((post) => !post.quotePostId || !remainingIds.has(post.quotePostId));
    if (readyIndex === -1) {
      ordered.push(...remaining);
      break;
    }

    const [ready] = remaining.splice(readyIndex, 1);
    remainingIds.delete(ready.id);
    ordered.push(ready);
  }

  return ordered;
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
  credentialRefresh: {
    checked: number;
    refreshed: number;
    failed: number;
    skipped: number;
  };
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
  const claimedIds = new Set<string>();

  for (const post of posts) {
    if (post.quotePostId && post.quotePost?.status === "scheduled" && !claimedIds.has(post.quotePostId)) {
      log.info(
        { postId: post.id, quotePostId: post.quotePostId },
        "Quote source was not claimed in this run — deferring quote",
      );
      continue;
    }

    const { count } = await prisma.post.updateMany({
      where: { id: post.id, status: "scheduled" },
      data: { status: "pending" },
    });

    if (count === 1) {
      claimed.push(post);
      claimedIds.add(post.id);
    } else {
      log.info({ postId: post.id }, "Post no longer claimable — skipping (claimed elsewhere or edited)");
    }
  }

  return claimed;
}

/**
 * Publishes claimed posts in dependency waves. Independent posts in a wave
 * still run concurrently, while a quote waits for a source claimed in the
 * same dispatch run to finish and persist its platform IDs first.
 */
async function publishClaimedPosts(posts: DuePost[]): Promise<DispatchPostResult[]> {
  const claimedIds = new Set(posts.map((post) => post.id));
  const completedIds = new Set<string>();
  const remaining = [...posts];
  const results: DispatchPostResult[] = [];

  while (remaining.length > 0) {
    let ready = remaining.filter(
      (post) => !post.quotePostId || !claimedIds.has(post.quotePostId) || completedIds.has(post.quotePostId),
    );

    if (ready.length === 0) {
      log.error(
        { postIds: remaining.map((post) => post.id) },
        "Cyclic quote dependencies detected; publishing will fail them with a source-state error",
      );
      ready = [...remaining];
    }

    const waveResults = await Promise.all(ready.map((post) => publishScheduledPost(post)));
    results.push(...waveResults);

    const readyIds = new Set(ready.map((post) => post.id));
    for (const post of ready) completedIds.add(post.id);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (readyIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }

  return results;
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

    let quoteTargets;
    if (post.quotePostId) {
      const quoteSource = await prisma.post.findFirst({
        where: { id: post.quotePostId, userId: post.userId },
        select: {
          status: true,
          accountResults: true,
          accounts: { select: { id: true, platform: true } },
        },
      });

      if (!quoteSource) {
        throw new Error("The post selected for quoting no longer exists.");
      }
      if (["draft", "scheduled", "pending"].includes(quoteSource.status)) {
        throw new Error("The post selected for quoting has not been published yet.");
      }
      if (quoteSource.status === "failed" && !hasSuccessfulQuoteSourceResult(quoteSource)) {
        throw new Error("The post selected for quoting failed before it produced any platform posts.");
      }

      const destinationAccounts = post.accounts.filter((account) => accountIds.includes(account.id));
      quoteTargets = buildQuoteTargets(quoteSource, destinationAccounts);
    }

    const postingResults = await postToAccounts(
      post.userId,
      post.message,
      post.media,
      accountIds,
      (post.accountOptions as AccountOptionsMap | null) ?? undefined,
      (post.accountOverrides as AccountOverridesMap | null) ?? undefined,
      post.thread ?? undefined,
      quoteTargets,
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

  // Runs concurrently with the dispatch below so a slow provider can't delay
  // due posts; per-account locks prevent races with publish-time refreshes.
  // The sweep never rejects, so this is only awaited for the run summary.
  const credentialRefreshPromise = refreshExpiringConnectedAccounts();

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
        quotePost: {
          select: {
            status: true,
          },
        },
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
  const duePostIds = new Set(duePosts.map((post) => post.id));
  const dispatchableDuePosts = orderPostsByQuoteDependencies(
    duePosts.filter((post) => {
      const sourceStatus = post.quotePost?.status;
      const sourceIsDueThisRun = !!post.quotePostId && sourceStatus === "scheduled" && duePostIds.has(post.quotePostId);
      const waiting =
        !!post.quotePostId &&
        !!sourceStatus &&
        (["draft", "pending"].includes(sourceStatus) || (sourceStatus === "scheduled" && !sourceIsDueThisRun));
      if (waiting) {
        log.info(
          { postId: post.id, quotePostId: post.quotePostId, sourceStatus },
          "Deferring quote until its source post is published",
        );
      }
      return !waiting;
    }),
  );

  if (duePosts.length === 0 && dueReposts.length === 0) {
    const credentialRefresh = await credentialRefreshPromise;
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      processedPosts: 0,
      publishedPosts: 0,
      failedPosts: 0,
      skippedPosts: 0,
      staleRecoveredPosts,
      credentialRefresh: {
        checked: credentialRefresh.checked,
        failed: credentialRefresh.failed,
        refreshed: credentialRefresh.refreshed,
        skipped: credentialRefresh.skipped,
      },
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
      ...dispatchableDuePosts.flatMap((post) => post.accounts.map((account) => account.platform.toLowerCase())),
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
  const postsToProcessIds = new Set<string>();
  const repostsToProcess: DueRepostPost[] = [];
  const skippedByPlatform = new Map<string, number>();

  for (const post of dispatchableDuePosts) {
    if (post.quotePostId && post.quotePost?.status === "scheduled" && !postsToProcessIds.has(post.quotePostId)) {
      log.info(
        { postId: post.id, quotePostId: post.quotePostId },
        "Quote source could not be dispatched in this run — deferring quote",
      );
      continue;
    }

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
    postsToProcessIds.add(post.id);
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
    publishClaimedPosts(claimedPosts),
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

  const credentialRefresh = await credentialRefreshPromise;
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
      credentialRefresh: {
        checked: credentialRefresh.checked,
        failed: credentialRefresh.failed,
        refreshed: credentialRefresh.refreshed,
        skipped: credentialRefresh.skipped,
      },
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
    credentialRefresh: {
      checked: credentialRefresh.checked,
      failed: credentialRefresh.failed,
      refreshed: credentialRefresh.refreshed,
      skipped: credentialRefresh.skipped,
    },
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
